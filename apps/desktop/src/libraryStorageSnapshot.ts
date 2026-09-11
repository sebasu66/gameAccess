import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
export const STORAGE_SNAPSHOT_EVENT = "gameaccess:installed-snapshot";
export function applyInstalledSnapshot(current: Record<number, ManagedDownloadStatus>, installedIds: number[]) {
  const ids = new Set(installedIds);
  const next = { ...current };
  for (const [key, status] of Object.entries(current)) {
    const state = gameStateManager.resolve(status);
    if (state.installed && !state.transferActive && !ids.has(Number(key))) next[Number(key)] = { ...status, state: "not-installed", installed: false, progress: null };
  }
  for (const id of ids) {
    const state = gameStateManager.resolve(current[id]);
    if (state.transferActive || state.storageBusy || state.frozen || state.prepared) continue;
    next[id] = { ...current[id], app_id: id, state: "installed", installed: true, progress: 100, bytes_downloaded: current[id]?.bytes_downloaded ?? null, bytes_total: current[id]?.bytes_total ?? null };
  }
  return next;
}
