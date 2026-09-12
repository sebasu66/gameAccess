import type { ManagedDownloadStatus } from "./downloadTypes";

export type GamePrimaryAction = "play" | "download" | "cancel" | "wait" | "verify";

export interface ResolvedGameState {
  technicalState: ManagedDownloadStatus["state"];
  primaryAction: GamePrimaryAction;
  playButtonReady: boolean;
  installed: boolean;
  prepared: boolean;
  frozen: boolean;
  transferActive: boolean;
  storageBusy: boolean;
  downloadComplete: boolean;
  canOpenInstallFolder: boolean;
  canUninstall: boolean;
  canFreeze: boolean;
  canThaw: boolean;
}

const DOWNLOAD_ACTIVE_STATES = new Set<ManagedDownloadStatus["state"]>([
  "requested",
  "preparing",
  "downloading",
  "paused",
  "cancelling",
]);

const STORAGE_BUSY_STATES = new Set<ManagedDownloadStatus["state"]>(["freezing", "thawing"]);
const STORAGE_AUTHORITATIVE_STATES = new Set<ManagedDownloadStatus["state"]>(["freezing", "frozen", "thawing"]);

function transferMetrics(base: ManagedDownloadStatus, overlay: ManagedDownloadStatus) {
  return {
    bytes_downloaded: overlay.bytes_downloaded ?? base.bytes_downloaded,
    bytes_total: overlay.bytes_total ?? base.bytes_total,
    speed_bps: overlay.speed_bps ?? base.speed_bps,
    eta_seconds: overlay.eta_seconds ?? base.eta_seconds,
  };
}

function providerMetadata(steam: ManagedDownloadStatus, provider: ManagedDownloadStatus) {
  return {
    ...steam,
    provider_id: provider.provider_id ?? steam.provider_id,
    prepared_target: provider.prepared_target ?? steam.prepared_target,
    job_id: provider.job_id ?? steam.job_id,
    worker_pid: provider.worker_pid ?? steam.worker_pid,
    error: provider.error ?? steam.error,
  };
}

/**
 * Canonical interpreter for a game's local technical state.
 *
 * Technical state and UI action are intentionally different concepts:
 * - `prepared` is NOT Steam-installed, but Play is enabled because pressing Play
 *   completes Steam discovery/validation before launch.
 * - `frozen` is NOT installed on disk, but Play is enabled because pressing Play
 *   transparently thaws the game before the normal launch pipeline.
 *
 * UI components must consume this class instead of re-deriving state flags from
 * raw `status.state`/`status.installed` combinations.
 */
export class GameStateManager {
  resolve(status?: ManagedDownloadStatus): ResolvedGameState {
    const technicalState = status?.state ?? "not-installed";
    const storageOverridesInstallation = STORAGE_AUTHORITATIVE_STATES.has(technicalState);
    const installed = !storageOverridesInstallation && (status?.installed === true || technicalState === "installed");
    const prepared = technicalState === "prepared";
    const frozen = technicalState === "frozen";

    // `playButtonReady` means the user can press Play now. It deliberately does
    // not mean "Steam has fully installed the game". Play may still perform a
    // prepared-file validation or a frozen-game thaw before launching.
    const transferActive = DOWNLOAD_ACTIVE_STATES.has(technicalState);
    const storageBusy = STORAGE_BUSY_STATES.has(technicalState);
    const playButtonReady = !transferActive && !storageBusy && (installed || prepared || frozen);
    const downloadComplete = installed || prepared;

    let primaryAction: GamePrimaryAction;
    if (storageBusy) primaryAction = "wait";
    else if (playButtonReady) primaryAction = "play";
    else if (transferActive) primaryAction = "cancel";
    else if (technicalState === "unknown") primaryAction = "verify";
    else primaryAction = "download";

    return {
      technicalState,
      primaryAction,
      playButtonReady,
      installed,
      prepared,
      frozen,
      transferActive,
      storageBusy,
      downloadComplete,
      canOpenInstallFolder: installed,
      canUninstall: installed,
      canFreeze: installed,
      canThaw: frozen,
    };
  }

  isTrackedDownload(status?: ManagedDownloadStatus): boolean {
    return this.resolve(status).transferActive;
  }

  isDownloadComplete(status?: ManagedDownloadStatus): boolean {
    return this.resolve(status).downloadComplete;
  }

  isPlayButtonReady(status?: ManagedDownloadStatus): boolean {
    return this.resolve(status).playButtonReady;
  }

  reconcileDownloadStatus(
    base: ManagedDownloadStatus | null | undefined,
    overlay: ManagedDownloadStatus | null | undefined,
  ): ManagedDownloadStatus | undefined {
    if (!base) return overlay ?? undefined;
    if (!overlay) return base;

    // Local freeze/thaw state represents the actual on-disk storage condition and
    // must beat stale provider/Steam observations until that transition finishes.
    if (STORAGE_AUTHORITATIVE_STATES.has(base.state)) return base;
    if (STORAGE_AUTHORITATIVE_STATES.has(overlay.state)) return overlay;

    const installed = this.resolve(base).installed || this.resolve(overlay).installed;

    if (this.isTrackedDownload(overlay)) {
      return {
        ...base,
        ...overlay,
        installed,
        ...transferMetrics(base, overlay),
      };
    }

    if (installed) {
      return {
        ...base,
        ...overlay,
        state: "installed",
        installed: true,
        progress: 100,
        ...transferMetrics(base, overlay),
        speed_bps: null,
        eta_seconds: 0,
      };
    }

    if (overlay.state === "cancelled") return { ...base, ...overlay, installed: false };

    // A terminal worker error must stop a stale requested/preparing overlay.
    if (overlay.error && overlay.state === "not-installed") return { ...base, ...overlay, installed: false };

    if (overlay.state === "unknown" || overlay.error) {
      return {
        ...overlay,
        ...base,
        error: overlay.error ?? base.error,
      };
    }

    return { ...base, ...overlay, installed: false };
  }

  reconcileSteamAndProviderStatus(
    steam: ManagedDownloadStatus,
    provider: ManagedDownloadStatus | null | undefined,
  ): ManagedDownloadStatus {
    if (STORAGE_AUTHORITATIVE_STATES.has(steam.state)) return steam;
    if (!provider) return steam;

    if (this.resolve(steam).installed) {
      return this.reconcileDownloadStatus(provider, steam) ?? steam;
    }

    if (this.isTrackedDownload(provider) || provider.state === "cancelled") {
      return this.reconcileDownloadStatus(steam, provider) ?? steam;
    }

    if (provider.state === "prepared" && provider.prepared_target) {
      return {
        ...steam,
        ...provider,
        state: "prepared",
        installed: false,
        progress: 100,
        ...transferMetrics(steam, provider),
        speed_bps: null,
        eta_seconds: 0,
      };
    }

    // Steam's current installation evidence is authoritative. A provider
    // "installed" record is only historical cache once Steam reports the app as
    // not installed (for example after Steam removed the appmanifest but left a
    // residual common/<game> directory). Only explicit Game Access transitional
    // states such as prepared/frozen are allowed to survive without a Steam
    // installation manifest.
    if (steam.state === "not-installed") {
      return providerMetadata(steam, provider);
    }

    if (this.resolve(provider).installed && provider.prepared_target) {
      return this.reconcileDownloadStatus(steam, provider) ?? steam;
    }

    return this.reconcileDownloadStatus(provider, steam) ?? steam;
  }

  reconcileDownloadMaps(
    base: Record<number, ManagedDownloadStatus>,
    overlay: Record<number, ManagedDownloadStatus>,
  ): Record<number, ManagedDownloadStatus> {
    const result: Record<number, ManagedDownloadStatus> = { ...base };
    for (const [rawAppId, status] of Object.entries(overlay)) {
      const appId = Number(rawAppId);
      const reconciled = this.reconcileDownloadStatus(result[appId], status);
      if (reconciled) result[appId] = reconciled;
    }
    return result;
  }
}

export const gameStateManager = new GameStateManager();
