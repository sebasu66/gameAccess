import { getCatalogMode } from "./catalogMode";
import { AsyncResourceCache, SingleFlightScheduler } from "./asyncResourceCache";
import type { SteamDownloadStatus } from "./native";

const ESTIMATE_TTL_MS = 30 * 60 * 1000;
const estimateCache = new AsyncResourceCache<string, SteamDownloadStatus | null>({ ttlMs: ESTIMATE_TTL_MS });
const estimateScheduler = new SingleFlightScheduler<string, SteamDownloadStatus | null>();

function estimateKey(appId: number, revision = "unknown"): string {
  return `${getCatalogMode()}|steam|${appId}|${revision}`;
}

export function requestDownloadEstimate(
  appId: number,
  loader: (appId: number) => Promise<SteamDownloadStatus | null>,
  revision = "unknown",
): Promise<SteamDownloadStatus | null> {
  const key = estimateKey(appId, revision);
  return estimateCache.get(key, () => estimateScheduler.request(key, () => loader(appId)));
}

export function invalidateDownloadEstimate(appId: number, revision = "unknown"): void {
  estimateCache.invalidate(estimateKey(appId, revision));
}

export function estimateQueueDepth(): number {
  return estimateScheduler.queuedCount();
}
