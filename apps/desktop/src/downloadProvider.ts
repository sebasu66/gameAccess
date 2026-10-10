import type { CatalogGame } from "./types";
import type { ManagedDownloadStatus, ManagedDownloadState } from "./downloadTypes";

/**
 * Standard phases of a game download or installation lifecycle.
 * Any engine (HTTP direct download, torrent, archive extractor, setup.exe)
 * can map its internal steps to these phases.
 */
export type DownloadPhase =
  | "queued"
  | "preparing"      // Initial checks, reserving space, acquiring metadata or tokens
  | "downloading"    // Actively transferring bits over network
  | "decompressing"  // Unpacking archives (.zip, .7z, .tar, .bin)
  | "installing"     // Running installation scripts, moving files, DirectX/VC runtime setup
  | "paused"         // Temporarily halted by the user or network scheduler
  | "cancelling"     // In the process of aborting and cleaning up temporary staging files
  | "cancelled"      // Aborted and cleaned up
  | "external"       // Source handed to a browser; no local installation occurred
  | "interrupted"    // Halted unexpectedly due to network failure, disk space, or process crash
  | "completed"      // Fully downloaded, extracted, and ready to launch
  | "error";         // Terminal error

/**
 * Real-time progress snapshot required by the visual progress components:
 * - `<GenericDownloadProgressView />` (LibraryDetailPanel)
 * - `<DownloadGameCard />` (DownloadCatalogPanel)
 */
export interface DownloadProgressSnapshot {
  /** Target game or app identifier */
  gameId: number;

  /** Current lifecycle phase */
  phase: DownloadPhase;

  /** Overall progress percentage from 0 to 100 */
  progress: number;

  /**
   * Optional custom descriptive text displayed directly on screen.
   * e.g., "Decompressing part 2 of 4...", "Checking file integrity...", "Extracting game files..."
   */
  statusText?: string;

  /** Number of bytes downloaded or processed so far */
  bytesDownloaded?: number;

  /** Total expected bytes */
  bytesTotal?: number;

  /** Current transfer or processing speed in bytes per second */
  speedBps?: number;

  /** Estimated remaining time in seconds */
  etaSeconds?: number;

  /** Error message if phase === "error" */
  error?: string | null;
}

/**
 * Optional parameters passed when requesting a download to start.
 */
export interface DownloadStartOptions {
  /** Target installation path if customizable */
  installPath?: string;
  /** Force full re-download ignoring existing cached or staged files */
  forceFresh?: boolean;
  /** Optional TorBox API key for accelerated debrid downloads */
  torboxKey?: string;
  /** Whether to retain archive files after post-download extraction */
  keepArchive?: boolean;
}

/**
 * Universal Interface that all download implementations must implement to be fully compliant
 * with the GameAccess desktop UI and visual progress components.
 */
export interface IDownloadProvider {
  /**
   * Unique name of the download provider (e.g. "http-direct", "digital-archive", "custom-installer")
   */
  readonly name: string;

  /**
   * Determines if this provider can handle downloading the given game.
   */
  canHandle(game: CatalogGame): boolean;

  /**
   * Starts or resumes the download process.
   * Must transition the state to "preparing" or "downloading".
   */
  start(game: CatalogGame, options?: DownloadStartOptions): Promise<void>;

  /**
   * Cancels the active download and cleans up any partial/staging files.
   */
  cancel(gameId: number): Promise<void>;

  /**
   * Queries the current progress snapshot on demand (for polling or component mounting).
   */
  getStatus(gameId: number): Promise<DownloadProgressSnapshot>;

  /**
   * Optional: Pauses the download if the engine supports pause/resume.
   */
  pause?(gameId: number): Promise<void>;

  /**
   * Optional: Resumes a paused download.
   */
  resume?(gameId: number): Promise<void>;

  /**
   * Optional: Allows reactive push updates instead of polling.
   * Returns an unsubscribe callback.
   */
  subscribe?(gameId: number, listener: (snapshot: DownloadProgressSnapshot) => void): () => void;
}

/**
 * Adapter utility that converts any compliant `DownloadProgressSnapshot` into the internal
 * `ManagedDownloadStatus` used by App.tsx and LibraryRoom.tsx state stores.
 */
export function snapshotToManagedStatus(snapshot: DownloadProgressSnapshot): ManagedDownloadStatus {
  let mappedState: ManagedDownloadState = "not-installed";
  let installed = false;

  switch (snapshot.phase) {
    case "queued":
      mappedState = "requested";
      break;
    case "preparing":
      mappedState = "preparing";
      break;
    case "downloading":
      mappedState = "downloading";
      break;
    case "decompressing":
      mappedState = "decompressing";
      break;
    case "installing":
      mappedState = "installing";
      break;
    case "paused":
      mappedState = "paused";
      break;
    case "cancelling":
      mappedState = "cancelling";
      break;
    case "cancelled":
      mappedState = "cancelled";
      break;
    case "interrupted":
      mappedState = "interrupted";
      break;
    case "completed":
      mappedState = "installed";
      installed = true;
      break;
    case "external":
      mappedState = "not-installed";
      break;
    case "error":
      mappedState = "not-installed";
      break;
    default:
      mappedState = snapshot.phase as ManagedDownloadState;
  }

  return {
    app_id: snapshot.gameId,
    state: mappedState,
    statusText: snapshot.statusText,
    progress: snapshot.progress,
    bytes_downloaded: snapshot.bytesDownloaded ?? null,
    bytes_total: snapshot.bytesTotal ?? null,
    speed_bps: snapshot.speedBps ?? null,
    eta_seconds: snapshot.etaSeconds ?? null,
    installed,
    error: snapshot.error ?? null,
  };
}

