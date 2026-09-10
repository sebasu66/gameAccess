import { invoke } from "@tauri-apps/api/core";

import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";

export const DOWNLOAD_REQUESTED_EVENT = "gameaccess:steam-download-requested";
export const DOWNLOAD_REQUEST_FAILED_EVENT = "gameaccess:steam-download-request-failed";
export const DOWNLOAD_CONFIRMATION_GRACE_MS = 90_000;
export const MAX_PARALLEL_DOWNLOADS = 2;

const CONTROL_STORAGE_KEY = "gameaccess:download-controls:v1";
const STALLED_PREPARING_MS = 10 * 60_000;
const STALLED_DOWNLOADING_MS = 5 * 60_000;
const STALLED_AT_100_MS = 2 * 60_000;

type ControlState = "queued" | "paused";

type RuntimeObservation = {
  signature: string;
  changedAt: number;
};

type PersistedControls = Record<number, ManagedDownloadStatus>;

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function statusSignature(status: ManagedDownloadStatus) {
  return [
    status.state,
    status.progress ?? "",
    status.bytes_downloaded ?? "",
    status.bytes_total ?? "",
    status.worker_pid ?? "",
  ].join("|");
}

function controlState(status: ManagedDownloadStatus | undefined): status is ManagedDownloadStatus & { state: ControlState } {
  return status?.state === "queued" || status?.state === "paused";
}

/**
 * Frontend authority for the managed-download lifecycle.
 *
 * Technical state semantics live in GameStateManager. This class owns runtime
 * lifecycle behavior: durable queue/pause overrides, progress, concurrency and
 * recovery of a provider worker whose persisted status stops advancing.
 */
export class DownloadManager {
  private observations = new Map<number, RuntimeObservation>();
  private recovering = new Set<number>();
  private startingQueued = new Set<number>();

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

  queuedStatus(appId: number, previous?: ManagedDownloadStatus): ManagedDownloadStatus {
    const status: ManagedDownloadStatus = {
      ...this.requestedStatus(appId),
      ...previous,
      app_id: appId,
      state: "queued",
      installed: false,
      worker_pid: null,
      speed_bps: null,
      eta_seconds: null,
      error: null,
      queued_at_ms: previous?.queued_at_ms ?? Date.now(),
    };
    this.setControl(status);
    return status;
  }

  runningCount(downloads: Record<number, ManagedDownloadStatus>): number {
    return Object.values(downloads).filter((status) => gameStateManager.resolve(status).downloadRunning).length;
  }

  shouldQueue(downloads: Record<number, ManagedDownloadStatus>): boolean {
    return this.runningCount(downloads) >= MAX_PARALLEL_DOWNLOADS;
  }

  nextQueued(downloads: Record<number, ManagedDownloadStatus>, slots: number): ManagedDownloadStatus[] {
    if (slots <= 0) return [];
    return Object.values(downloads)
      .filter((status) => gameStateManager.resolve(status).queued && !this.startingQueued.has(status.app_id))
      .sort((left, right) => (left.queued_at_ms ?? 0) - (right.queued_at_ms ?? 0))
      .slice(0, slots);
  }

  claimQueued(appId: number): boolean {
    if (this.startingQueued.has(appId)) return false;
    this.startingQueued.add(appId);
    return true;
  }

  releaseQueuedClaim(appId: number) {
    this.startingQueued.delete(appId);
  }

  cancelQueued(appId: number): ManagedDownloadStatus {
    this.clearControl(appId);
    this.observations.delete(appId);
    return {
      ...this.requestedStatus(appId),
      state: "cancelled",
      progress: null,
    };
  }

  async pause(status: ManagedDownloadStatus): Promise<ManagedDownloadStatus> {
    if (!status.job_id) throw new Error("La descarga administrada no tiene un jobId verificable.");
    const cancelled = await invoke<ManagedDownloadStatus>("cancel_provider_download", {
      appId: status.app_id,
      jobId: status.job_id,
    });
    const paused: ManagedDownloadStatus = {
      ...cancelled,
      ...status,
      state: "paused",
      installed: false,
      worker_pid: null,
      speed_bps: null,
      eta_seconds: null,
      error: null,
    };
    this.setControl(paused);
    this.observations.delete(status.app_id);
    return paused;
  }

  async resume(status: ManagedDownloadStatus): Promise<ManagedDownloadStatus> {
    const previousControl = this.controlFor(status.app_id);
    try {
      const started = await invoke<ManagedDownloadStatus>("start_provider_download", {
        appId: status.app_id,
        jobId: status.job_id ?? null,
        libraryIndex: status.library_index ?? null,
      });
      this.clearControl(status.app_id);
      this.observations.delete(status.app_id);
      return started;
    } catch (error) {
      if (previousControl) this.setControl(previousControl);
      throw error;
    }
  }

  /**
   * Returns true only after a provider status has stopped changing for long
   * enough to be considered stalled. A 100% transfer gets a shorter timeout:
   * the worker should leave `downloading` after the CDN phase completes.
   */
  shouldRecover(status: ManagedDownloadStatus, now = Date.now()): boolean {
    if (!status.job_id || !["preparing", "downloading", "recovering"].includes(status.state)) {
      this.observations.delete(status.app_id);
      return false;
    }
    if (status.worker_pid == null && status.state !== "preparing") return true;

    const signature = statusSignature(status);
    const previous = this.observations.get(status.app_id);
    if (!previous || previous.signature !== signature) {
      this.observations.set(status.app_id, { signature, changedAt: now });
      return false;
    }

    const progress = this.progress(status);
    const threshold = status.state === "preparing"
      ? STALLED_PREPARING_MS
      : progress >= 99.9
        ? STALLED_AT_100_MS
        : STALLED_DOWNLOADING_MS;
    return now - previous.changedAt >= threshold;
  }

  async recover(status: ManagedDownloadStatus): Promise<ManagedDownloadStatus> {
    if (!status.job_id || this.recovering.has(status.app_id)) return status;
    this.recovering.add(status.app_id);
    try {
      try {
        await invoke<ManagedDownloadStatus>("cancel_provider_download", {
          appId: status.app_id,
          jobId: status.job_id,
        });
      } catch {
        // A dead worker may already be gone. start_provider_download performs
        // its own worker identity check before publishing a replacement job.
      }
      const restarted = await invoke<ManagedDownloadStatus>("start_provider_download", {
        appId: status.app_id,
        jobId: status.job_id,
        libraryIndex: status.library_index ?? null,
      });
      this.clearControl(status.app_id);
      this.observations.delete(status.app_id);
      return restarted;
    } finally {
      this.recovering.delete(status.app_id);
    }
  }

  recoveringStatus(status: ManagedDownloadStatus): ManagedDownloadStatus {
    return {
      ...status,
      state: "recovering",
      speed_bps: null,
      eta_seconds: null,
      error: null,
    };
  }

  restoreStatuses(statuses: ManagedDownloadStatus[]): ManagedDownloadStatus[] {
    const byApp = new Map(statuses.map((status) => [status.app_id, status]));
    const controls = this.readControls();
    for (const [rawAppId, control] of Object.entries(controls)) {
      const appId = Number(rawAppId);
      const provider = byApp.get(appId);
      if (provider && gameStateManager.isDownloadComplete(provider)) {
        this.clearControl(appId);
        continue;
      }
      byApp.set(appId, provider ? { ...provider, ...control } : control);
    }
    return [...byApp.values()];
  }

  applyControlOverride(status: ManagedDownloadStatus): ManagedDownloadStatus {
    const control = this.controlFor(status.app_id);
    if (!control) return status;
    if (gameStateManager.isDownloadComplete(status)) {
      this.clearControl(status.app_id);
      return status;
    }
    return { ...status, ...control };
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

  private readControls(): PersistedControls {
    if (!storageAvailable()) return {};
    try {
      const value = JSON.parse(localStorage.getItem(CONTROL_STORAGE_KEY) || "{}");
      if (!value || typeof value !== "object") return {};
      const controls: PersistedControls = {};
      for (const [rawAppId, candidate] of Object.entries(value as Record<string, unknown>)) {
        const appId = Number(rawAppId);
        if (!Number.isFinite(appId) || !candidate || typeof candidate !== "object") continue;
        const status = candidate as ManagedDownloadStatus;
        if (!controlState(status)) continue;
        controls[appId] = status;
      }
      return controls;
    } catch {
      return {};
    }
  }

  private writeControls(controls: PersistedControls) {
    if (!storageAvailable()) return;
    localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(controls));
  }

  private controlFor(appId: number): ManagedDownloadStatus | undefined {
    return this.readControls()[appId];
  }

  private setControl(status: ManagedDownloadStatus) {
    if (!controlState(status)) return;
    const controls = this.readControls();
    controls[status.app_id] = status;
    this.writeControls(controls);
  }

  private clearControl(appId: number) {
    const controls = this.readControls();
    if (!(appId in controls)) return;
    delete controls[appId];
    this.writeControls(controls);
  }
}

export const downloadManager = new DownloadManager();
