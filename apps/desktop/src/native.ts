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
