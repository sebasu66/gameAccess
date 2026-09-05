import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";

export const DOWNLOAD_REQUESTED_EVENT = "gameaccess:steam-download-requested";
export const DOWNLOAD_REQUEST_FAILED_EVENT = "gameaccess:steam-download-request-failed";
export const DOWNLOAD_CONFIRMATION_GRACE_MS = 90_000;

const ACTIVE_STATES = new Set<ManagedDownloadStatus["state"]>([
  "requested",
  "preparing",
  "downloading",
  "paused",
  "cancelling",
]);

export function isTrackedDownload(status?: ManagedDownloadStatus): boolean {
  return Boolean(status && ACTIVE_STATES.has(status.state));
}

export function requestedDownloadStatus(appId: number): ManagedDownloadStatus {
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
  downloads: Record<number, ManagedDownloadStatus>,
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

export function didDownloadJustComplete(previousState: string | undefined, status: ManagedDownloadStatus): boolean {
  if (!previousState || !ACTIVE_STATES.has(previousState as ManagedDownloadStatus["state"])) return false;
  return Boolean(status.installed || status.state === "installed");
}

export function shouldReleaseMissingDownload(
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

export function downloadProgress(status?: ManagedDownloadStatus): number {
  if (!status) return 0;
  if (status.installed || status.state === "installed") return 100;
  const total = status.bytes_total ?? 0;
  const downloaded = status.bytes_downloaded ?? 0;
  const fromBytes = total > 0 ? downloaded / total * 100 : null;
  const raw = fromBytes ?? status.progress ?? 0;
  return Math.max(0, Math.min(100, raw));
}

export function formatDownloadBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDownloadEta(seconds: number | null | undefined): string {
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

export function formatDownloadSpeed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0 B/s";
  return `${formatDownloadBytes(value)}/s`;
}
