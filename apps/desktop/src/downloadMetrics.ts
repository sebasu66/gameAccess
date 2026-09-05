import type { SteamDownloadStatus } from "./native";

export type DownloadMetrics = {
  download_total_bytes?: number | null;
  downloaded_bytes?: number | null;
  installed_size_bytes?: number | null;
  estimated_install_size_bytes?: number | null;
  speed_bps?: number | null;
  eta_seconds?: number | null;
  size_source?: string | null;
  size_estimated?: boolean;
  progress_kind?: "transfer" | "disk-estimate" | null;
};

export type DownloadStatusWithMetrics = SteamDownloadStatus & DownloadMetrics;

export function metricsOf(status?: SteamDownloadStatus): DownloadMetrics {
  return (status ?? {}) as DownloadMetrics;
}

export function calculateEtaSeconds(
  downloadedBytes: number | null | undefined,
  totalBytes: number | null | undefined,
  speedBps: number | null | undefined,
): number | null {
  if (![downloadedBytes, totalBytes, speedBps].every((value) => value != null && Number.isFinite(value))) return null;
  const downloaded = Number(downloadedBytes);
  const total = Number(totalBytes);
  const speed = Number(speedBps);
  if (downloaded < 0 || total < 0 || speed < 0) return null;
  if (downloaded >= total) return 0;
  if (speed === 0) return null;
  return Math.max(0, (total - downloaded) / speed);
}

export type RateSample = { atMs: number; bytes: number };

export function observedTransferRate(samples: RateSample[], nowMs: number, windowMs = 15_000): number | null {
  const valid = samples
    .filter((sample) => Number.isFinite(sample.atMs) && Number.isFinite(sample.bytes) && sample.atMs <= nowMs && sample.atMs >= nowMs - windowMs && sample.bytes >= 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (valid.length < 2) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const dt = (last.atMs - first.atMs) / 1000;
  const delta = last.bytes - first.bytes;
  if (dt <= 0 || delta < 0) return null;
  return delta / dt;
}
