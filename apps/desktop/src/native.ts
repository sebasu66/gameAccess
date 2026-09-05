import { invoke } from "@tauri-apps/api/core";

import { getCatalogMode } from "./catalogMode";
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
  state: "not-installed" | "requested" | "preparing" | "downloading" | "paused" | "installed" | "unknown";
  progress: number | null;
  bytes_downloaded: number | null;
  bytes_total: number | null;
  installed: boolean;
  provider_id?: string | null;
  prepared_target?: string | null;
  error?: string | null;
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
  active: boolean;
}

export interface LocalSteamPool {
  source: string;
  verification_complete: boolean;
  verified_at: string | null;
  accounts: LocalSteamAccount[];
  games: Array<{ app_id: number; name: string; developer?: string; publisher?: string }>;
  library_folders?: SteamLibraryFolder[];
}

export async function getLocalSteamPool(): Promise<LocalSteamPool | null> {
  if (hasTauriRuntime()) return invoke<LocalSteamPool>("local_steam_pool");
  try { return await bridgeRequest<LocalSteamPool>("/local-steam-pool"); }
  catch { return null; }
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
  while (Date.now() < deadline) {
    const status = await steamDownloadStatus(appId);
    if (status.error) throw new Error(status.error);
    if (status.installed || ["preparing", "downloading", "paused"].includes(status.state)) return;
    await delay(900);
  }
  throw new Error("Steam no confirmÃ³ el inicio de la descarga. La solicitud se quitÃ³ de pendientes.");
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
  if (!appId) throw new Error("Este juego todavÃ­a no tiene Steam AppID configurado.");
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
    if (getCatalogMode() === "gameaccess") {
      await invoke<SteamDownloadStatus>("start_provider_download", { appId });
      await waitForSteamInstallConfirmation(appId);
      return;
    }

    const pool = await getLocalSteamPool();
    if (!pool) throw new Error("No se pudo leer el inventario local de licencias Steam.");
    const accountLabel = resolveSteamInstallOwner(pool.accounts, appId);
    await switchSteamAccount(accountLabel);
    await invoke("open_steam_install", { appId });
    await waitForSteamInstallConfirmation(appId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dispatchDownloadEvent("gameaccess:steam-download-request-failed", appId, message);
    throw error;
  }
}

export async function openSteamRun(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavÃ­a no tiene Steam AppID configurado.");
  if (!hasTauriRuntime()) {
    try {
      await bridgeRequest("/open-steam-run", { method: "POST", body: JSON.stringify({ appId }) });
    } catch {
      window.location.href = `steam://run/${appId}`;
    }
    return;
  }

  const pool = await getLocalSteamPool();
  if (!pool) {
    await invoke("open_steam_run", { appId });
    return;
  }

  let ownerLabel: string;
  try {
    ownerLabel = resolveSteamInstallOwner(pool.accounts, appId);
  } catch {
    // Provider/leased sessions do not necessarily exist in the local ownership pool yet.
    await invoke("open_steam_run", { appId });
    return;
  }

  await switchSteamAccount(ownerLabel);
  const refreshed = await getLocalSteamPool() ?? pool;
  const owner = findSteamAccount(refreshed.accounts, ownerLabel) ?? findSteamAccount(pool.accounts, ownerLabel);
  if (!owner) throw new Error(`No se pudo resolver la cuenta Steam propietaria de AppID ${appId}.`);

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
  await invoke("login_provider_steam", credentials);
}

function rememberActiveSteamAccount(pool: LocalSteamPool | null): void {
  const previous = pool?.accounts.find((account) => account.active);
  if (!previous) return;
  rememberPreviousSteamAccount({
    accountName: accountName(previous),
    userId32: previous.user_id32 ?? null,
  });
}

async function tryDirectSteamSwitch(
  target: LocalSteamAccount | undefined,
): Promise<SteamAccountSwitchResult | null> {
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
    return { ok: true, stage: "ready", message: `Steam ya estÃ¡ usando ${target.label}.` };
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
  if (!appId) throw new Error("AppID invÃ¡lido");
  if (!hasTauriRuntime()) {
    try { return await bridgeRequest<SteamDownloadStatus>(`/steam-download-status/${appId}`); }
    catch { return { app_id: appId, state: "unknown", progress: null, bytes_downloaded: null, bytes_total: null, installed: false }; }
  }
  if (getCatalogMode() === "gameaccess") {
    const providerStatus = await invoke<SteamDownloadStatus | null>("provider_download_status", { appId });
    if (providerStatus) return providerStatus;
  }
  return invoke<SteamDownloadStatus>("steam_download_status", { appId });
}

export async function getMachineProfile(): Promise<MachineProfile | null> {
  if (hasTauriRuntime()) return invoke<MachineProfile>("machine_profile");
  try { return await bridgeRequest<MachineProfile>("/machine-profile"); }
  catch { return null; }
}

const steamStoreMetadataRequests = new Map<number, Promise<Record<string, unknown> | null>>();

export async function getSteamStoreMetadata(appId: number): Promise<Record<string, unknown> | null> {
  if (!appId) return null;
  const existing = steamStoreMetadataRequests.get(appId);
  if (existing) return existing;
  const request = (async () => {
    if (hasTauriRuntime()) return invoke<Record<string, unknown>>("steam_store_metadata", { appId });
    try { return await bridgeRequest<Record<string, unknown>>(`/steam-store-metadata/${appId}`); }
    catch { return null; }
  })();
  steamStoreMetadataRequests.set(appId, request);
  try { return await request; }
  finally { steamStoreMetadataRequests.delete(appId); }
}
