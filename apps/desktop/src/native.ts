import { invoke } from "@tauri-apps/api/core";

import { resolveSteamInstallOwner } from "./steamOwnership";
import { safeSteamRestoreMode } from "./steamRestorePolicy";
import {
  consumePreviousSteamAccount,
  loadSteamSessionPreferences,
  rememberPreviousSteamAccount,
} from "./steamSessionPreferences";

export const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface SteamDownloadStatus {
  app_id: number;
  state: "not-installed" | "requested" | "preparing" | "downloading" | "installed" | "unknown";
  progress: number | null;
  bytes_downloaded: number | null;
  bytes_total: number | null;
  installed: boolean;
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
}

export async function getLocalSteamPool(): Promise<LocalSteamPool | null> {
  if (!hasTauriRuntime()) return null;
  return invoke<LocalSteamPool>("local_steam_pool");
}

export async function verifyLocalSteamInventory(): Promise<void> {
  if (!hasTauriRuntime()) throw new Error("La verificación de licencias requiere la app de escritorio.");
  await invoke("verify_local_steam_inventory");
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
  if (hasTauriRuntime()) {
    const pool = await getLocalSteamPool();
    if (!pool) throw new Error("No se pudo leer el inventario local de licencias Steam.");
    const accountLabel = resolveSteamInstallOwner(pool.accounts, appId);
    await switchSteamAccount(accountLabel);
    await invoke("open_steam_install", { appId });
    return;
  }
  window.location.href = `steam://install/${appId}`;
}

export async function openSteamRun(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  if (!hasTauriRuntime()) {
    window.location.href = `steam://run/${appId}`;
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
  const restoreTarget = preferences.restoreMode === "main"
    ? mainAccountName
    : preferences.restoreMode === "previous"
      ? previous?.accountName
      : null;
  const hasRestoreCredential = restoreTarget ? await hasSteamCredential(restoreTarget) : false;
  const restoreMode = safeSteamRestoreMode(preferences.restoreMode, restoreTarget, hasRestoreCredential);

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

export async function switchSteamAccount(accountLabel: string): Promise<SteamAccountSwitchResult> {
  if (!accountLabel.trim()) throw new Error("El proveedor no tiene un perfil Steam visible configurado.");
  if (!hasTauriRuntime()) throw new Error("El cambio automático de perfil Steam requiere la app de escritorio gameAccess.");

  const pool = await getLocalSteamPool();
  const target = pool ? findSteamAccount(pool.accounts, accountLabel) : undefined;
  if (target?.active) {
    return { ok: true, stage: "ready", message: `Steam ya está usando ${target.label}.` };
  }

  const previous = pool?.accounts.find((account) => account.active);
  if (previous) {
    rememberPreviousSteamAccount({ accountName: accountName(previous), userId32: previous.user_id32 ?? null });
  }

  if (target) {
    const targetName = accountName(target);
    if (targetName && await hasSteamCredential(targetName)) {
      const direct = await invoke<SteamAccountSwitchResult>("direct_switch_steam_account", {
        accountName: targetName,
        expectedUserId32: target.user_id32 ?? null,
      });
      if (!direct.ok) throw new Error(direct.message || "Steam no pudo iniciar la cuenta configurada.");
      return direct;
    }
  }

  const result = await invoke<SteamAccountSwitchResult>("switch_steam_account", { accountLabel });
  if (!result.ok) throw new Error(result.message || "Steam no pudo cambiar de perfil.");
  return result;
}

export async function steamInstalled(): Promise<boolean> {
  if (!hasTauriRuntime()) return true;
  return invoke<boolean>("steam_installed");
}

export async function getRuntimePrerequisites(): Promise<RuntimePrerequisites> {
  if (!hasTauriRuntime()) return { runtime_ok: true, steam_installed: true, steam_path: null, account_file_present: true, remembered_accounts: 1 };
  return invoke<RuntimePrerequisites>("runtime_prerequisites");
}

export async function openSteamClient(): Promise<void> {
  if (!hasTauriRuntime()) return;
  await invoke("open_steam_client");
}

export async function steamDownloadStatus(appId: number): Promise<SteamDownloadStatus> {
  if (!appId) throw new Error("AppID inválido");
  if (!hasTauriRuntime()) {
    return { app_id: appId, state: "unknown", progress: null, bytes_downloaded: null, bytes_total: null, installed: false };
  }
  return invoke<SteamDownloadStatus>("steam_download_status", { appId });
}

export async function getMachineProfile(): Promise<MachineProfile | null> {
  if (!hasTauriRuntime()) return null;
  return invoke<MachineProfile>("machine_profile");
}

export async function getSteamStoreMetadata(appId: number): Promise<Record<string, unknown> | null> {
  if (!appId || !hasTauriRuntime()) return null;
  return invoke<Record<string, unknown> | null>("steam_store_metadata", { appId });
}
