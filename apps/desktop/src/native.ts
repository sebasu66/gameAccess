import { invoke } from "@tauri-apps/api/core";

import { getCatalogMode } from "./catalogMode";
import { narrate } from "./narrationLog";
import { cancelDownloadLifecycle, registerDownloadJob } from "./downloadLifecycle";
import { reconcileSteamAndProviderStatus } from "./downloadState";
import { resolveSteamInstallOwner } from "./steamOwnership";
import { safeSteamRestoreMode } from "./steamRestorePolicy";
import {
  consumePreviousSteamAccount,
  loadSteamSessionPreferences,
  rememberPreviousSteamAccount,
} from "./steamSessionPreferences";
import type { SteamRestoreMode } from "./steamSessionPreferences";

export const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LOCAL_BRIDGE = (import.meta.env.VITE_GAMEACCESS_LOCAL_BRIDGE ?? "http://127.0.0.1:1431").replace(/\/$/, "");

async function bridgeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LOCAL_BRIDGE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep the HTTP status when the bridge did not return JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface SteamDownloadStatus {
  app_id: number;
  state: "not-installed" | "requested" | "preparing" | "downloading" | "paused" | "cancelling" | "cancelled" | "prepared" | "installed" | "unknown";
  progress: number | null;
  bytes_downloaded: number | null;
  bytes_total: number | null;
  speed_bps?: number | null;
  eta_seconds?: number | null;
  installed: boolean;
  provider_id?: string | null;
  prepared_target?: string | null;
  error?: string | null;
  job_id?: string | null;
  worker_pid?: number | null;
}

export interface SteamLibraryFolder {
  index: number;
  path: string;
  label: string;
}

export interface MachineProfile {
  memory_gb: number | null;
  cpu: string | null;
  gpus: string[];
}

export interface RuntimePrerequisites {
  runtime_ok: boolean;
  steam_installed: boolean;
  steam_path: string | null;
  account_file_present: boolean;
  remembered_accounts: number;
}

export interface VisualDebugConfig {
  enabled: boolean;
  session_dir: string | null;
}

export async function getVisualDebugConfig(): Promise<VisualDebugConfig> {
  if (!hasTauriRuntime()) return { enabled: false, session_dir: null };
  return invoke<VisualDebugConfig>("visual_debug_config");
}

export async function captureVisualDebug(label: string): Promise<string> {
  if (!hasTauriRuntime()) throw new Error("Visual debug capture requires the desktop app.");
  return invoke<string>("capture_visual_debug", { label });
}

export async function finishVisualDebug(results: unknown): Promise<string> {
  if (!hasTauriRuntime()) throw new Error("Visual debug capture requires the desktop app.");
  return invoke<string>("finish_visual_debug", { results });
}

export async function setVisualDebugViewport(mode: "medium" | "maximized"): Promise<void> {
  if (!hasTauriRuntime()) throw new Error("Visual debug viewport control requires the desktop app.");
  await invoke("set_visual_debug_viewport", { mode });
}

export interface LocalSteamAccount {
  label: string;
  account_name: string;
  steam_id64?: string;
  user_id32?: number | null;
  app_ids: number[];
  accessible_app_ids: number[];
  ticketed_app_count?: number;
  ownership_source?: string;
  ownership_verified?: boolean;
  ownership_verified_at?: string | null;
  active: boolean;
}

export interface LocalSteamPool {
  source: string;
  verification_complete: boolean;
  verified_at: string | null;
  ownership_error?: string | null;
  verified_account_count?: number;
  accounts: LocalSteamAccount[];
  games: Array<{ app_id: number; name: string; developer?: string; publisher?: string }>;
  library_folders?: SteamLibraryFolder[];
}


export async function getLocalSteamPool(): Promise<LocalSteamPool | null> {
  await narrate("Native layer: reading Steam remembered accounts and their local library/access data.", { area: "LOCAL STEAM" });
  try {
    const pool = hasTauriRuntime()
      ? await invoke<LocalSteamPool>("local_steam_pool")
      : await bridgeRequest<LocalSteamPool>("/local-steam-pool");
    await narrate(
      `Native Steam scan completed: ${pool.accounts.length} remembered account(s), ${pool.games.length} game record(s), source='${pool.source}'.`,
      { area: "LOCAL STEAM" },
    );
    return pool;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`Native Steam scan failed: ${message}.`, { area: "LOCAL STEAM", level: "ERROR" });
    return null;
  }
}

export async function verifyLocalSteamInventory(): Promise<void> {
  if (hasTauriRuntime()) {
    await invoke("verify_local_steam_inventory");
    return;
  }
  await bridgeRequest("/verify-local-steam-inventory", { method: "POST" });
}

export interface SteamAccountSwitchResult {
  ok: boolean;
  stage: string;
  message: string;
}

export interface SteamSessionStatus {
  phase: string;
  appId: number | null;
  accountName: string | null;
  message: string;
  done: boolean;
  error: string | null;
}

function accountName(account: LocalSteamAccount): string {
  return (account.account_name || account.label || "").trim();
}

function findSteamAccount(accounts: LocalSteamAccount[], label: string): LocalSteamAccount | undefined {
  const target = label.trim().toLocaleLowerCase("en");
  return accounts.find((account) =>
    account.label.trim().toLocaleLowerCase("en") === target
    || account.account_name.trim().toLocaleLowerCase("en") === target,
  );
}

export async function hasAutomaticSteamLogin(accountNameValue: string): Promise<boolean> {
  const target = accountNameValue.trim();
  if (!target || !hasTauriRuntime()) return false;
  const pool = await getLocalSteamPool();
  if (pool && findSteamAccount(pool.accounts, target)) return true;
  return hasSteamCredential(target);
}

async function resolveSessionRestoreMode(
  requestedMode: SteamRestoreMode,
  mainAccountName: string | null,
  previousAccountName: string | null | undefined,
): Promise<SteamRestoreMode> {
  let targetAccountName: string | null | undefined = null;
  if (requestedMode === "main") targetAccountName = mainAccountName;
  if (requestedMode === "previous") targetAccountName = previousAccountName;
  const canAutoLogin = targetAccountName ? await hasAutomaticSteamLogin(targetAccountName) : false;
  return safeSteamRestoreMode(requestedMode, targetAccountName, canAutoLogin);
}

function dispatchDownloadEvent(name: string, appId: number, error?: string) {
  window.dispatchEvent(new CustomEvent(name, { detail: { appId, error } }));
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));


async function waitForSteamInstallConfirmation(appId: number): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastState = "";
  while (Date.now() < deadline) {
    const status = await steamDownloadStatus(appId);
    if (status.state !== lastState) {
      lastState = status.state;
      await narrate(
        `Download for Steam AppID ${appId}: state changed to '${status.state}'${status.progress != null ? ` at ${Math.round(status.progress)}%` : ""}.`,
        { area: "DOWNLOAD" },
      );
    }
    if (status.error) {
      await narrate(`Download for Steam AppID ${appId} reported an error: ${status.error}.`, { area: "DOWNLOAD", level: "ERROR" });
      throw new Error(status.error);
    }
    if (status.installed) {
      await narrate(`Download for Steam AppID ${appId}: installation is complete and the game is ready on disk.`, { area: "DOWNLOAD" });
      return;
    }
    if (["preparing", "downloading", "paused"].includes(status.state)) {
      await narrate(`Steam confirmed that download work for AppID ${appId} has started.`, { area: "DOWNLOAD" });
      return;
    }
    await delay(900);
  }
  await narrate(`Steam did not confirm download start for AppID ${appId} within 90 seconds.`, { area: "DOWNLOAD", level: "ERROR" });
  throw new Error("Steam no confirmó el inicio de la descarga. La solicitud se quitó de pendientes.");
}

export async function saveSteamCredential(accountName: string, password: string): Promise<void> {
  if (!hasTauriRuntime()) throw new Error("Steam credential enrollment requires the desktop app.");
  await invoke("save_steam_credential", { accountName, password });
}

export async function removeSteamCredential(accountName: string): Promise<void> {
  if (!hasTauriRuntime()) return;
  await invoke("remove_steam_credential", { accountName });
}

export async function hasSteamCredential(accountName: string): Promise<boolean> {
  if (!hasTauriRuntime() || !accountName.trim()) return false;
  return invoke<boolean>("has_steam_credential", { accountName });
}

export async function getSteamSessionStatus(): Promise<SteamSessionStatus> {
  if (!hasTauriRuntime()) {
    return { phase: "idle", appId: null, accountName: null, message: "Browser preview", done: true, error: null };
  }
  return invoke<SteamSessionStatus>("steam_session_status");
}


export async function openSteamInstall(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  const mode = getCatalogMode();
  await narrate(`Download requested for Steam AppID ${appId}. Current catalog mode is '${mode}'.`, { area: "DOWNLOAD" });
  const lifecycle = hasTauriRuntime() ? await registerDownloadJob(appId) : null;
  dispatchDownloadEvent("gameaccess:steam-download-requested", appId);
  if (!hasTauriRuntime()) {
    try {
      await narrate(`Browser/local-bridge mode: asking the local bridge to start Steam install for AppID ${appId}.`, { area: "DOWNLOAD" });
      await bridgeRequest("/open-steam-install", { method: "POST", body: JSON.stringify({ appId }) });
      await waitForSteamInstallConfirmation(appId);
    } catch {
      await narrate(`Local bridge could not start AppID ${appId}; falling back to the Steam install URI.`, { area: "DOWNLOAD", level: "WARN" });
      window.location.href = `steam://install/${appId}`;
    }
    return;
  }

  try {
    if (mode === "gameaccess") {
      await narrate(`GameAccess mode: asking the provider download manager to resolve a usable provider license and start AppID ${appId}.`, { area: "DOWNLOAD" });
      const status = await invoke<SteamDownloadStatus>("start_provider_download", { appId, jobId: lifecycle?.job_id ?? null });
      await narrate(`Provider download manager accepted AppID ${appId}${status.provider_id ? ` using provider '${status.provider_id}'` : ""}; state='${status.state}'.`, { area: "DOWNLOAD" });
      await waitForSteamInstallConfirmation(appId);
      return;
    }

    await narrate(`Private/local mode: resolving which remembered Steam account is considered the owner candidate for AppID ${appId}.`, { area: "DOWNLOAD" });
    const pool = await getLocalSteamPool();
    if (!pool) throw new Error("No se pudo leer el inventario local de licencias Steam.");
    const accountLabel = resolveSteamInstallOwner(pool.accounts, appId);
    await narrate(`Private/local download rule selected Steam account '${accountLabel}' for AppID ${appId}. Switching account before sending Steam the install request.`, { area: "ACCOUNT" });
    await switchSteamAccount(accountLabel);
    await invoke("open_steam_install", { appId });
    await narrate(`Steam install request sent for AppID ${appId}. Waiting for Steam to confirm work started.`, { area: "DOWNLOAD" });
    await waitForSteamInstallConfirmation(appId);
  } catch (error) {
    if (lifecycle) await cancelDownloadLifecycle(appId).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`Download request for AppID ${appId} failed: ${message}.`, { area: "DOWNLOAD", level: "ERROR" });
    dispatchDownloadEvent("gameaccess:steam-download-request-failed", appId, message);
    throw error;
  }
}


export async function openSteamClientInstall(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  await narrate(`Direct Steam-client download requested for AppID ${appId}. This bypasses GameAccess provider download selection.`, { area: "DOWNLOAD" });
  const lifecycle = hasTauriRuntime() ? await registerDownloadJob(appId) : null;
  dispatchDownloadEvent("gameaccess:steam-download-requested", appId);
  if (!hasTauriRuntime()) {
    try {
      await bridgeRequest("/open-steam-install", { method: "POST", body: JSON.stringify({ appId }) });
      await waitForSteamInstallConfirmation(appId);
    } catch {
      window.location.href = `steam://install/${appId}`;
    }
    return;
  }
  try {
    await invoke("open_steam_install", { appId });
    await narrate(`Steam client install URI sent for AppID ${appId}.`, { area: "DOWNLOAD" });
    await waitForSteamInstallConfirmation(appId);
  } catch (error) {
    if (lifecycle) await cancelDownloadLifecycle(appId).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`Direct Steam-client download failed for AppID ${appId}: ${message}.`, { area: "DOWNLOAD", level: "ERROR" });
    throw error;
  }
}


export async function openSteamRun(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  await narrate(`Launch requested for Steam AppID ${appId}. Resolving the Steam account and launch route.`, { area: "LAUNCH" });
  if (!hasTauriRuntime()) {
    try {
      await bridgeRequest("/open-steam-run", { method: "POST", body: JSON.stringify({ appId }) });
      await narrate(`Local bridge accepted the launch request for AppID ${appId}.`, { area: "LAUNCH" });
    } catch {
      await narrate(`Local bridge failed for AppID ${appId}; falling back to steam://run/${appId}.`, { area: "LAUNCH", level: "WARN" });
      window.location.href = `steam://run/${appId}`;
    }
    return;
  }

  const pool = await getLocalSteamPool();
  if (!pool) {
    await narrate(`No local Steam pool was available for AppID ${appId}. Sending the run request directly to Steam without an account switch.`, { area: "LAUNCH", level: "WARN" });
    await invoke("open_steam_run", { appId });
    return;
  }

  let ownerLabel: string;
  try {
    ownerLabel = resolveSteamInstallOwner(pool.accounts, appId);
    await narrate(`Local launch rule resolved Steam account '${ownerLabel}' for AppID ${appId}.`, { area: "ACCOUNT" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`No local owner candidate could be resolved for AppID ${appId}: ${message}. Current code is falling back to a direct Steam run request.`, { area: "LAUNCH", level: "WARN" });
    await invoke("open_steam_run", { appId });
    return;
  }

  await narrate(`Switching Steam to '${ownerLabel}' before launching AppID ${appId}.`, { area: "ACCOUNT" });
  await switchSteamAccount(ownerLabel);
  const refreshed = await getLocalSteamPool() ?? pool;
  const owner = findSteamAccount(refreshed.accounts, ownerLabel) ?? findSteamAccount(pool.accounts, ownerLabel);
  if (!owner) {
    await narrate(`After switching, account '${ownerLabel}' could not be found in the refreshed remembered-account pool. Launch is aborted.`, { area: "ACCOUNT", level: "ERROR" });
    throw new Error(`No se pudo resolver la cuenta Steam propietaria de AppID ${appId}.`);
  }

  const preferences = loadSteamSessionPreferences();
  const previous = consumePreviousSteamAccount();
  const main = preferences.mainAccountName
    ? findSteamAccount(refreshed.accounts, preferences.mainAccountName)
    : undefined;
  const mainAccountName = main ? accountName(main) : preferences.mainAccountName;
  const restoreMode = await resolveSessionRestoreMode(
    preferences.restoreMode,
    mainAccountName,
    previous?.accountName,
  );

  await narrate(`Starting tracked Steam game session for AppID ${appId} under '${accountName(owner)}'. Restore policy after play: '${restoreMode}'.`, { area: "LAUNCH" });
  await invoke<SteamSessionStatus>("start_steam_game_session", {
    request: {
      appId,
      accountName: accountName(owner),
      expectedUserId32: owner.user_id32 ?? null,
      restoreMode,
      mainAccountName,
      mainUserId32: main?.user_id32 ?? null,
      previousAccountName: previous?.accountName ?? null,
      previousUserId32: previous?.userId32 ?? null,
    },
  });
}


export async function loginProviderSteam(credentials: { accountName: string; password: string; expectedUserId32: number }): Promise<void> {
  if (!hasTauriRuntime()) throw new Error("El login de proveedores requiere la aplicación de escritorio.");
  await narrate(`Starting provider Steam login for account '${credentials.accountName}'. Password and authentication material are intentionally omitted from the log.`, { area: "ACCOUNT" });
  await invoke("login_provider_steam", credentials);
  await narrate(`Provider Steam login completed for account '${credentials.accountName}'.`, { area: "ACCOUNT" });
}

function rememberActiveSteamAccount(pool: LocalSteamPool | null): void {
  const previous = pool?.accounts.find((account) => account.active);
  if (!previous) return;
  rememberPreviousSteamAccount({
    accountName: accountName(previous),
    userId32: previous.user_id32 ?? null,
  });
}

async function tryDirectSteamSwitch(target: LocalSteamAccount | undefined): Promise<SteamAccountSwitchResult | null> {
  if (!target) return null;
  const targetName = accountName(target);
  if (!targetName) return null;
  if (!(await hasSteamCredential(targetName))) return null;
  const direct = await invoke<SteamAccountSwitchResult>("direct_switch_steam_account", {
    accountName: targetName,
    expectedUserId32: target.user_id32 ?? null,
  });
  if (!direct.ok) throw new Error(direct.message || "Steam no pudo iniciar la cuenta configurada.");
  return direct;
}

export async function switchSteamAccount(accountLabel: string): Promise<SteamAccountSwitchResult> {
  if (!accountLabel.trim()) throw new Error("El proveedor no tiene un perfil Steam visible configurado.");
  if (!hasTauriRuntime()) {
    const result = await bridgeRequest<SteamAccountSwitchResult>("/switch-steam-account", {
      method: "POST",
      body: JSON.stringify({ accountLabel }),
    });
    if (!result.ok) throw new Error(result.message || "Steam no pudo cambiar de perfil.");
    return result;
  }

  const pool = await getLocalSteamPool();
  const target = pool ? findSteamAccount(pool.accounts, accountLabel) : undefined;
  if (target?.active) {
    return { ok: true, stage: "ready", message: `Steam ya está usando ${target.label}.` };
  }

  rememberActiveSteamAccount(pool);
  const direct = await tryDirectSteamSwitch(target);
  if (direct) return direct;

  const result = await invoke<SteamAccountSwitchResult>("switch_steam_account", { accountLabel });
  if (!result.ok) throw new Error(result.message || "Steam no pudo cambiar de perfil.");
  return result;
}

export async function steamInstalled(): Promise<boolean> {
  if (hasTauriRuntime()) return invoke<boolean>("steam_installed");
  try { return await bridgeRequest<boolean>("/steam-installed"); }
  catch { return true; }
}

export async function steamInstalledAppIds(): Promise<number[]> {
  if (!hasTauriRuntime()) return [];
  try { return await invoke<number[]>("installed_app_ids"); }
  catch { return []; }
}

export async function getRuntimePrerequisites(): Promise<RuntimePrerequisites> {
  if (hasTauriRuntime()) return invoke<RuntimePrerequisites>("runtime_prerequisites");
  try { return await bridgeRequest<RuntimePrerequisites>("/runtime-prerequisites"); }
  catch { return { runtime_ok: true, steam_installed: true, steam_path: null, account_file_present: true, remembered_accounts: 1 }; }
}

export async function openSteamClient(): Promise<void> {
  if (hasTauriRuntime()) {
    await invoke("open_steam_client");
    return;
  }
  await bridgeRequest("/open-steam-client", { method: "POST" });
}

export async function steamDownloadStatus(appId: number): Promise<SteamDownloadStatus> {
  if (!appId) throw new Error("AppID inválido");
  if (!hasTauriRuntime()) {
    try { return await bridgeRequest<SteamDownloadStatus>(`/steam-download-status/${appId}`); }
    catch { return { app_id: appId, state: "unknown", progress: null, bytes_downloaded: null, bytes_total: null, installed: false }; }
  }
  if (getCatalogMode() !== "gameaccess") {
    return invoke<SteamDownloadStatus>("steam_download_status", { appId });
  }

  const [steamResult, providerResult] = await Promise.allSettled([
    invoke<SteamDownloadStatus>("steam_download_status", { appId }),
    invoke<SteamDownloadStatus | null>("provider_download_status", { appId }),
  ]);

  if (steamResult.status === "fulfilled") {
    return reconcileSteamAndProviderStatus(
      steamResult.value,
      providerResult.status === "fulfilled" ? providerResult.value : null,
    );
  }
  if (providerResult.status === "fulfilled" && providerResult.value) return providerResult.value;

  return {
    app_id: appId,
    state: "unknown",
    progress: null,
    bytes_downloaded: null,
    bytes_total: null,
    installed: false,
    error: steamResult.reason instanceof Error ? steamResult.reason.message : String(steamResult.reason ?? "No se pudo verificar la instalación"),
  };
}

export async function providerDownloadEstimate(appId: number): Promise<SteamDownloadStatus | null> {
  if (!appId || !hasTauriRuntime() || getCatalogMode() !== "gameaccess") return null;
  try { return await invoke<SteamDownloadStatus>("provider_download_estimate", { appId }); }
  catch { return null; }
}

export async function getMachineProfile(): Promise<MachineProfile | null> {
  if (hasTauriRuntime()) return invoke<MachineProfile>("machine_profile");
  try { return await bridgeRequest<MachineProfile>("/machine-profile"); }
  catch { return null; }
}

const steamStoreMetadataCache = new Map<number, Record<string, unknown>>();
const steamStoreMetadataRequests = new Map<number, Promise<Record<string, unknown> | null>>();

export async function getSteamStoreMetadata(appId: number): Promise<Record<string, unknown> | null> {
  if (!appId) return null;
  const cached = steamStoreMetadataCache.get(appId);
  if (cached) return cached;
  const existing = steamStoreMetadataRequests.get(appId);
  if (existing) return existing;
  const request = (async () => {
    if (hasTauriRuntime()) return invoke<Record<string, unknown>>("steam_store_metadata", { appId });
    try { return await bridgeRequest<Record<string, unknown>>(`/steam-store-metadata/${appId}`); }
    catch { return null; }
  })();
  steamStoreMetadataRequests.set(appId, request);
  try {
    const value = await request;
    if (value) steamStoreMetadataCache.set(appId, value);
    return value;
  } finally {
    steamStoreMetadataRequests.delete(appId);
  }
}
