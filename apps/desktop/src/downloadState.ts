import type { SteamDownloadStatus } from "./native";

const ACTIVE_STATES = new Set<SteamDownloadStatus["state"]>([
  "requested",
  "preparing",
  "downloading",
  "paused",
  "cancelling",
]);

export function isTransferState(status: SteamDownloadStatus | null | undefined): boolean {
  return Boolean(status && ACTIVE_STATES.has(status.state));
}

export function reconcileDownloadStatus(
  base: SteamDownloadStatus | null | undefined,
  overlay: SteamDownloadStatus | null | undefined,
): SteamDownloadStatus | undefined {
  if (!base) return overlay ?? undefined;
  if (!overlay) return base;

  const installed = Boolean(
    base.installed || base.state === "installed" || overlay.installed || overlay.state === "installed",
  );

  if (isTransferState(overlay)) {
    return {
      ...base,
      ...overlay,
      installed,
      bytes_downloaded: overlay.bytes_downloaded ?? base.bytes_downloaded,
      bytes_total: overlay.bytes_total ?? base.bytes_total,
      speed_bps: overlay.speed_bps ?? base.speed_bps,
      eta_seconds: overlay.eta_seconds ?? base.eta_seconds,
    };
  }

  if (installed) {
    return {
      ...base,
      ...overlay,
      state: "installed",
      installed: true,
      progress: 100,
      bytes_downloaded: overlay.bytes_downloaded ?? base.bytes_downloaded,
      bytes_total: overlay.bytes_total ?? base.bytes_total,
      speed_bps: null,
      eta_seconds: 0,
    };
  }

  if (overlay.state === "cancelled") return { ...base, ...overlay, installed: false };

  if (overlay.state === "unknown" || overlay.error) {
    return {
      ...overlay,
      ...base,
      error: overlay.error ?? base.error,
    };
  }

  return { ...base, ...overlay, installed: false };
}

export function reconcileSteamAndProviderStatus(
  steam: SteamDownloadStatus,
  provider: SteamDownloadStatus | null | undefined,
): SteamDownloadStatus {
  if (!provider) return steam;

  if (steam.installed || steam.state === "installed") {
    return reconcileDownloadStatus(provider, steam) ?? steam;
  }

  if (isTransferState(provider) || provider.state === "cancelled") {
    return reconcileDownloadStatus(steam, provider) ?? steam;
  }

  if (provider.state === "prepared" && provider.prepared_target) {
    return {
      ...steam,
      ...provider,
      state: "prepared",
      installed: false,
      progress: 100,
      bytes_downloaded: provider.bytes_downloaded ?? steam.bytes_downloaded,
      bytes_total: provider.bytes_total ?? steam.bytes_total,
      speed_bps: null,
      eta_seconds: 0,
    };
  }

  if ((provider.installed || provider.state === "installed") && provider.prepared_target) {
    return reconcileDownloadStatus(steam, provider) ?? steam;
  }

  if (steam.state === "not-installed") {
    return {
      ...steam,
      provider_id: provider.provider_id ?? steam.provider_id,
      prepared_target: provider.prepared_target ?? steam.prepared_target,
      job_id: provider.job_id ?? steam.job_id,
      worker_pid: provider.worker_pid ?? steam.worker_pid,
      error: provider.error ?? steam.error,
    };
  }

  return reconcileDownloadStatus(provider, steam) ?? steam;
}

export function reconcileDownloadMaps(
  base: Record<number, SteamDownloadStatus>,
  overlay: Record<number, SteamDownloadStatus>,
): Record<number, SteamDownloadStatus> {
  const result: Record<number, SteamDownloadStatus> = { ...base };
  for (const [rawAppId, status] of Object.entries(overlay)) {
    const appId = Number(rawAppId);
    const reconciled = reconcileDownloadStatus(result[appId], status);
    if (reconciled) result[appId] = reconciled;
  }
  return result;
}
