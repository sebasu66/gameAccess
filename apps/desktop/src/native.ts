import { invoke } from "@tauri-apps/api/core";

const hasTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

export async function openSteamInstall(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  if (hasTauri()) {
    await invoke("open_steam_install", { appId });
    return;
  }
  window.location.href = `steam://install/${appId}`;
}

export async function openSteamRun(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  if (hasTauri()) {
    await invoke("open_steam_run", { appId });
    return;
  }
  window.location.href = `steam://run/${appId}`;
}

export async function steamInstalled(): Promise<boolean> {
  if (!hasTauri()) return true;
  return invoke<boolean>("steam_installed");
}

export async function steamDownloadStatus(appId: number): Promise<SteamDownloadStatus> {
  if (!appId) throw new Error("AppID inválido");
  if (!hasTauri()) {
    return { app_id: appId, state: "unknown", progress: null, bytes_downloaded: null, bytes_total: null, installed: false };
  }
  return invoke<SteamDownloadStatus>("steam_download_status", { appId });
}

export async function getMachineProfile(): Promise<MachineProfile | null> {
  if (!hasTauri()) return null;
  return invoke<MachineProfile>("machine_profile");
}
