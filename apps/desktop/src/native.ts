import { invoke } from "@tauri-apps/api/core";

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

export async function openSteamInstall(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  if (hasTauriRuntime()) {
    await invoke("open_steam_install", { appId });
    return;
  }
  window.location.href = `steam://install/${appId}`;
}

export async function openSteamRun(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  if (hasTauriRuntime()) {
    await invoke("open_steam_run", { appId });
    return;
  }
  window.location.href = `steam://run/${appId}`;
}

export async function switchSteamAccount(accountLabel: string): Promise<SteamAccountSwitchResult> {
  if (!accountLabel.trim()) throw new Error("El proveedor no tiene un perfil Steam visible configurado.");
  if (!hasTauriRuntime()) throw new Error("El cambio automático de perfil Steam requiere la app de escritorio gameAccess.");
  const result = await invoke<SteamAccountSwitchResult>("switch_steam_account", { accountLabel });
  if (!result.ok) throw new Error(result.message || "Steam no pudo cambiar de perfil.");
  return result;
}

export async function steamInstalled(): Promise<boolean> {
  if (!hasTauriRuntime()) return true;
  return invoke<boolean>("steam_installed");
}

export async function getRuntimePrerequisites(): Promise<RuntimePrerequisites> {
  if (!hasTauriRuntime()) return { runtime_ok:true, steam_installed:true, steam_path:null, account_file_present:true, remembered_accounts:1 };
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
  return invoke<Record<string, unknown>>("steam_store_metadata", { appId });
}
