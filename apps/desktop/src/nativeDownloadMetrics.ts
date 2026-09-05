import { invoke } from "@tauri-apps/api/core";

import type { DownloadMetrics } from "./downloadMetrics";
import type { SteamDownloadStatus } from "./native";

export async function steamDownloadMetrics(appId: number): Promise<DownloadMetrics> {
  if (!appId || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return {};
  try { return await invoke<DownloadMetrics>("steam_download_metrics", { appId }); }
  catch { return {}; }
}

export function providerEstimateMetrics(status: SteamDownloadStatus | null | undefined): DownloadMetrics {
  if (!status) return {};
  const legacyDiskEstimate = status.bytes_total;
  return {
    estimated_install_size_bytes: legacyDiskEstimate,
    size_source: legacyDiskEstimate != null ? "provider-depot-disk-estimate" : null,
    size_estimated: legacyDiskEstimate != null,
    progress_kind: null,
  };
}
