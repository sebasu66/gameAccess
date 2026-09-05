import type { SteamDownloadStatus } from "./native";

const ACTIVE_STATES = new Set<SteamDownloadStatus["state"]>([
  "requested",
  "preparing",
  "downloading",
  "paused",
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

  // Transfer state is independent from installation evidence. This matters for
  // updates: a game may already be installed while a new build is downloading.
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

  // A failed/unknown overlay is not fresh negative evidence and must not erase a
  // more specific base state.
  if (overlay.state === "unknown" || overlay.error) {
    return {
      ...overlay,
      ...base,
      error: overlay.error ?? base.error,
    };
  }

  return { ...base, ...overlay, installed: false };
}

/**
 * Reconcile a freshly-read Steam manifest with the provider cache.
 * Steam is always consulted first. A cached provider `not-installed`, error or
 * malformed result must therefore never hide a valid local Steam installation.
 */
export function reconcileSteamAndProviderStatus(
  steam: SteamDownloadStatus,
  provider: SteamDownloadStatus | null | undefined,
): SteamDownloadStatus {
  if (!provider) return steam;

  if (steam.installed || steam.state === "installed") {
    return reconcileDownloadStatus(provider, steam) ?? steam;
  }

  if (isTransferState(provider)) {
    return reconcileDownloadStatus(steam, provider) ?? steam;
  }

  // Provider installations are only considered usable when the provider has a
  // concrete prepared target. Rust also validates cached provider targets before
  // adding them to the global installed inventory.
  if ((provider.installed || provider.state === "installed") && provider.prepared_target) {
    return reconcileDownloadStatus(steam, provider) ?? steam;
  }

  // Fresh local negative evidence wins over old provider cache state. Keep only
  // non-authoritative provider metadata that can help a later provider request.
  if (steam.state === "not-installed") {
    return {
      ...steam,
      provider_id: provider.provider_id ?? steam.provider_id,
      prepared_target: provider.prepared_target ?? steam.prepared_target,
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
