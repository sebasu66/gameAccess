import { invoke } from "@tauri-apps/api/core";

const hasTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
