import { invoke } from "@tauri-apps/api/core";

import { gameStateManager } from "./GameStateManager";
import { narrate } from "./narrationLog";
import type { SteamDownloadStatus } from "./native";

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const GAME_STORAGE_STATE_CHANGED_EVENT = "gameaccess:game-storage-state-changed";

export interface GameStorageState {
  app_id: number;
  state: "not-installed" | "installed" | "freezing" | "frozen" | "thawing" | "unknown";
  original_size_bytes: number | null;
  stored_size_bytes: number | null;
  archive_path: string | null;
  error: string | null;
}

function storageStateStatus(state: GameStorageState): SteamDownloadStatus {
  return {
    app_id: state.app_id,
    state: state.state,
    progress: state.state === "installed" || state.state === "frozen" ? 100 : null,
    bytes_downloaded: null,
    bytes_total: null,
    installed: state.state === "installed",
    error: state.error,
  };
}

function dispatchStorageState(status: SteamDownloadStatus) {
  window.dispatchEvent(new CustomEvent(GAME_STORAGE_STATE_CHANGED_EVENT, { detail: { status } }));
}

async function currentStorageStatus(appId: number): Promise<SteamDownloadStatus> {
  return invoke<SteamDownloadStatus>("steam_download_status", { appId }).catch(() => ({
    app_id: appId,
    state: "unknown" as const,
    progress: null,
    bytes_downloaded: null,
    bytes_total: null,
    installed: false,
  }));
}

export async function steamFrozenStatuses(): Promise<SteamDownloadStatus[]> {
  if (!hasTauriRuntime()) return [];
  try { return await invoke<SteamDownloadStatus[]>("frozen_game_statuses"); }
  catch { return []; }
}

export async function freezeGame(appId: number): Promise<SteamDownloadStatus> {
  if (!appId || !hasTauriRuntime()) throw new Error("Freeze requiere la aplicación de escritorio.");
  dispatchStorageState({ app_id: appId, state: "freezing", progress: null, bytes_downloaded: null, bytes_total: null, installed: false });
  await narrate(`Freezing Steam AppID ${appId}: moving it outside steamapps and compressing it with Zstandard.`, { area: "STORAGE" });
  try {
    const state = await invoke<GameStorageState>("freeze_game", { appId });
    const status = storageStateStatus(state);
    dispatchStorageState(status);
    await narrate(`Steam AppID ${appId} is frozen and will be restored automatically before Play.`, { area: "STORAGE" });
    return status;
  } catch (error) {
    dispatchStorageState(await currentStorageStatus(appId));
    throw error;
  }
}

export async function thawGame(appId: number): Promise<SteamDownloadStatus> {
  if (!appId || !hasTauriRuntime()) throw new Error("Restore requiere la aplicación de escritorio.");
  dispatchStorageState({ app_id: appId, state: "thawing", progress: null, bytes_downloaded: null, bytes_total: null, installed: false });
  await narrate(`Restoring frozen Steam AppID ${appId} before launch.`, { area: "STORAGE" });
  try {
    await invoke<GameStorageState>("thaw_game", { appId });
    const status = await currentStorageStatus(appId);
    dispatchStorageState(status);
    await narrate(`Steam AppID ${appId} was restored to its original Steam Library.`, { area: "STORAGE" });
    return status;
  } catch (error) {
    dispatchStorageState(await currentStorageStatus(appId));
    throw error;
  }
}

async function waitForSteamUninstall(appId: number): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const status = await currentStorageStatus(appId);
    if (!status.installed && status.state === "not-installed") {
      dispatchStorageState(status);
      await narrate(`Steam confirmed AppID ${appId} is no longer installed.`, { area: "STORAGE" });
      return;
    }
    await delay(1000);
  }
}

export async function uninstallGame(appId: number): Promise<void> {
  if (!appId || !hasTauriRuntime()) throw new Error("Uninstall requiere la aplicación de escritorio.");
  await invoke("uninstall_game", { appId });
  await narrate(`Steam uninstall flow opened for AppID ${appId}; Steam remains authoritative for deletion.`, { area: "STORAGE" });
  void waitForSteamUninstall(appId).catch(() => undefined);
}

export async function prepareFrozenGameForPlay(appId: number): Promise<void> {
  if (!hasTauriRuntime()) return;
  const status = await currentStorageStatus(appId);
  if (!gameStateManager.resolve(status).frozen) return;
  await thawGame(appId);
}
