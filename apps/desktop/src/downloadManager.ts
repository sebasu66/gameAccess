import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";

export const DOWNLOAD_REQUESTED_EVENT = "gameaccess:steam-download-requested";
export const DOWNLOAD_REQUEST_FAILED_EVENT = "gameaccess:steam-download-request-failed";
export const DOWNLOAD_CONFIRMATION_GRACE_MS = 90_000;

/**
 * Frontend authority for the managed-download lifecycle.
 *
 * This class owns download tracking/progress/completion helpers. It intentionally
 * does NOT duplicate technical state semantics; those live in GameStateManager.
 */
export class DownloadManager {
  isTracked(status?: ManagedDownloadStatus): boolean {
    return gameStateManager.isTrackedDownload(status);
  }

  requestedStatus(appId: number): ManagedDownloadStatus {
    return {
      app_id: appId,
      state: "requested",
      progress: null,
      bytes_downloaded: null,
      bytes_total: null,
      installed: false,
    };
  }

  pinGames(
    games: CatalogGame[],
    downloads: Record<number, ManagedDownloadStatus>,
    trackedAppIds: number[],
  ): CatalogGame[] {
    const originalPosition = new Map(games.map((game, index) => [game.id, index]));
    const requestPosition = new Map(trackedAppIds.map((appId, index) => [appId, index]));
    const pinned = games.filter((game) => {
      if (!game.app_id) return false;
      return requestPosition.has(game.app_id) || this.isTracked(downloads[game.app_id]);
    });
    const normal = games.filter((game) => !pinned.includes(game));

    pinned.sort((left, right) => {
      const leftRequest = left.app_id ? requestPosition.get(left.app_id) : undefined;
      const rightRequest = right.app_id ? requestPosition.get(right.app_id) : undefined;
      if (leftRequest !== undefined || rightRequest !== undefined) {
        return (leftRequest ?? Number.MAX_SAFE_INTEGER) - (rightRequest ?? Number.MAX_SAFE_INTEGER);
      }
      return (originalPosition.get(left.id) ?? 0) - (originalPosition.get(right.id) ?? 0);
    });

    return [...pinned, ...normal];
  }

  didJustComplete(previousState: string | undefined, status: ManagedDownloadStatus): boolean {
    if (!previousState) return false;
    const previous = { ...status, state: previousState as ManagedDownloadStatus["state"] };
    if (!this.isTracked(previous)) return false;
    return gameStateManager.isDownloadComplete(status);
  }

  shouldReleaseMissing(
    status: ManagedDownloadStatus,
    wasActive: boolean,
    missingPolls: number,
    elapsedMs: number,
  ): boolean {
    if (status.state !== "not-installed" && status.state !== "cancelled") return false;
    if (status.state === "cancelled") return true;
    if (wasActive) return missingPolls >= 2;
    return elapsedMs >= DOWNLOAD_CONFIRMATION_GRACE_MS;
  }

  progress(status?: ManagedDownloadStatus): number {
    if (!status) return 0;
    const resolved = gameStateManager.resolve(status);
    if (resolved.downloadComplete || resolved.frozen) return 100;
    const total = status.bytes_total ?? 0;
    const downloaded = status.bytes_downloaded ?? 0;
    const fromBytes = total > 0 ? downloaded / total * 100 : null;
    const raw = fromBytes ?? status.progress ?? 0;
    return Math.max(0, Math.min(100, raw));
  }

  formatBytes(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value) || value < 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  formatEta(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
    const rounded = Math.ceil(seconds);
    if (rounded === 0) return "0 s";
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    if (hours > 0) return `${hours} h ${Math.max(1, minutes)} min`;
    if (minutes > 0) return `${minutes} min ${secs ? `${secs} s` : ""}`.trim();
    return `${secs} s`;
  }

  formatSpeed(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value) || value < 0) return "—";
    if (value === 0) return "0 B/s";
    return `${this.formatBytes(value)}/s`;
  }
}

export const downloadManager = new DownloadManager();
