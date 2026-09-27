import { invoke } from "@tauri-apps/api/core";

import { narrate } from "./narrationLog";
import type { SteamDownloadStatus } from "./native";

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const GAME_STORAGE_STATE_CHANGED_EVENT = "gameaccess:game-storage-state-changed";

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
  if (!appId || !hasTauriRuntime()) throw new Error("Desinstalar requiere la aplicación de escritorio.");
  await invoke("uninstall_game", { appId });
  await narrate(`Steam uninstall flow opened for AppID ${appId}; Steam remains authoritative for deletion.`, { area: "STORAGE" });
  void waitForSteamUninstall(appId).catch(() => undefined);
}
