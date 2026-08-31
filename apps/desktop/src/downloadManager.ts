import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

export const DOWNLOAD_REQUESTED_EVENT = "gameaccess:steam-download-requested";
export const DOWNLOAD_REQUEST_FAILED_EVENT = "gameaccess:steam-download-request-failed";
export const DOWNLOAD_CONFIRMATION_GRACE_MS = 45_000;

const ACTIVE_STATES = new Set<SteamDownloadStatus["state"]>([
  "requested",
  "preparing",
  "downloading",
  "paused",
]);

export function isTrackedDownload(status?: SteamDownloadStatus): boolean {
  return Boolean(status && ACTIVE_STATES.has(status.state));
}

export function requestedDownloadStatus(appId: number): SteamDownloadStatus {
  return {
    app_id: appId,
    state: "requested",
    progress: null,
    bytes_downloaded: null,
    bytes_total: null,
    installed: false,
  };
}

export function pinDownloadingGames(
  games: CatalogGame[],
  downloads: Record<number, SteamDownloadStatus>,
  trackedAppIds: number[],
): CatalogGame[] {
  const originalPosition = new Map(games.map((game, index) => [game.id, index]));
  const requestPosition = new Map(trackedAppIds.map((appId, index) => [appId, index]));
  const pinned = games.filter((game) => {
    if (!game.app_id) return false;
    return requestPosition.has(game.app_id) || isTrackedDownload(downloads[game.app_id]);
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

export function shouldReleaseMissingDownload(
  status: SteamDownloadStatus,
  wasActive: boolean,
  missingPolls: number,
  elapsedMs: number,
): boolean {
  if (status.state !== "not-installed") return false;
  if (wasActive) return missingPolls >= 2;
  return elapsedMs >= DOWNLOAD_CONFIRMATION_GRACE_MS;
}
