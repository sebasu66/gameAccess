import { invoke } from "@tauri-apps/api/core";
import type { CatalogGame } from "../types";
import type { DownloadPhase, DownloadProgressSnapshot, IDownloadProvider, DownloadStartOptions } from "../downloadProvider";
import { snapshotToManagedStatus } from "../downloadProvider";
import type { ManagedDownloadStatus } from "../downloadTypes";
import { digitalProcessManager } from "./DigitalProcessManager";
import type { DigitalGameRecord } from "./DigitalCatalog";

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Dedicated Download & Execution Manager exclusively for the Digital tab.
 *
 * Keeps all digital game operations completely isolated from GameAccess:
 * - No Steam account provider pooling
 * - No courtesy keys or credit reservations
 * - Directly passes parameters from digital_catalog.json (downloadSource, installProcess, playProcess, uninstallProcess)
 *   to the Python download script or native execution commands.
 */
export class DigitalDownloadService implements IDownloadProvider {
  readonly name = "digital-python-downloader";
  private activeJobs = new Map<number, DownloadProgressSnapshot>();
  private listeners = new Map<number, Set<(snapshot: DownloadProgressSnapshot) => void>>();
  private globalListeners = new Set<(snapshot: DownloadProgressSnapshot) => void>();
  private digitalRecords = new Map<number, DigitalGameRecord>();

  /**
   * Subscribes to all digital download updates across all games.
   */
  onGlobalUpdate(listener: (snapshot: DownloadProgressSnapshot) => void): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  /**
   * Registers or updates digital catalog records from digital_catalog.json.
   */
  registerRecords(records: DigitalGameRecord[]): void {
    for (const record of records) {
      if (record && typeof record.id === "number") {
        this.digitalRecords.set(record.id, record);
      }
    }
  }

  /**
   * Returns the digital parameters for a specific game ID.
   */
  getRecord(gameId: number): DigitalGameRecord | undefined {
    return this.digitalRecords.get(gameId);
  }

  /**
   * Determines if this service handles the game (all digital catalog games).
   */
  canHandle(game: CatalogGame): boolean {
    return Boolean(game.id || game.app_id);
  }

  /**
   * Starts downloading/installing a digital game using the parameters from digital_catalog.json.
   * Invokes the Python download script via Tauri passing:
   *   --app-id, --name, --source (downloadSource), --install-process (installProcess)
   */
  async start(game: CatalogGame, options?: DownloadStartOptions & { record?: DigitalGameRecord }): Promise<void> {
    const gameId = game.app_id ?? game.id;
    const record = options?.record || this.getRecord(gameId) || this.getRecord(game.app_id ?? 0);
    console.log(`[DigitalDownloaderService:start] Starting for gameId=${gameId}, record=`, record);

    const initialSnapshot: DownloadProgressSnapshot = {
      gameId,
      phase: "preparing",
      progress: 0,
      statusText: "Iniciando gestor de descarga...",
      bytesDownloaded: 0,
      bytesTotal: 0,
    };
    this.updateSnapshot(initialSnapshot);

    const appId = record?.id ?? game.app_id ?? gameId;
    const name = record?.name ?? game.name;
    const downloadSource = (record?.downloadSource ?? (game as any).downloadSource ?? "").trim();
    const installProcess = record?.installProcess ?? "";
    console.log(`[DigitalDownloaderService:start] Params: appId=${appId}, name='${name}', source='${downloadSource}'`);

    if (!downloadSource) {
      const errorMsg = `El juego '${name}' no posee fuentes de descarga disponibles.`;
      console.error(`[DigitalDownloaderService:start] No downloadSource: ${errorMsg}`);
      this.updateSnapshot({
        gameId,
        phase: "error",
        progress: 0,
        statusText: "Sin fuentes de descarga disponibles",
        error: errorMsg,
      });
      throw new Error(errorMsg);
    }

    if (hasTauriRuntime()) {
      try {
        console.log(`[DigitalDownloaderService:start] Invoking Tauri start_digital_download...`);
        const result = await invoke("start_digital_download", {
          appId,
          name,
          downloadSource,
          installProcess,
          torboxKey: options?.torboxKey,
          keepArchive: options?.keepArchive,
        });
        console.log(`[DigitalDownloaderService:start] start_digital_download response:`, result);
        this.startStatusPolling(gameId, appId);
      } catch (err) {
        console.error(`[DigitalDownloaderService:start] Error invoking start_digital_download:`, err);
        // Fallback or report error in snapshot
        this.updateSnapshot({
          gameId,
          phase: "error",
          progress: 0,
          statusText: "Error al iniciar proceso de descarga",
          error: String(err),
        });
        throw err;
      }
    } else {
      console.log(`[DigitalDownloaderService:start] Web mock environment: opening download link`);
      window.open(downloadSource, "_blank");
      this.updateSnapshot({
        gameId,
        phase: "downloading",
        progress: 100,
        statusText: "Enlace de descarga abierto en el navegador.",
      });
    }
  }

  private pollingIntervals = new Map<number, any>();

  private startStatusPolling(gameId: number, appId: number): void {
    console.log(`[DigitalDownloaderService:polling] Starting status polling for gameId=${gameId}, appId=${appId}`);
    if (this.pollingIntervals.has(gameId)) {
      clearInterval(this.pollingIntervals.get(gameId));
    }
    const interval = setInterval(async () => {
      if (!hasTauriRuntime()) return;
      try {
        const raw = await invoke<any>("digital_download_status", { appId });
        console.log(`[DigitalDownloaderService:polling] Status from Tauri for ${appId}:`, raw);
        if (raw && raw.phase) {
          const snapshot: DownloadProgressSnapshot = {
            gameId,
            phase: raw.phase,
            progress: raw.progressPercent ?? 0,
            statusText: raw.statusText ?? "",
            bytesDownloaded: raw.bytesDownloaded ?? 0,
            bytesTotal: raw.totalBytes ?? 0,
            speedBps: raw.speedBps ?? 0,
            etaSeconds: raw.etaSeconds ?? 0,
            error: raw.error,
          };
          this.updateSnapshot(snapshot);
          if (["completed", "error", "cancelled"].includes(raw.phase)) {
            console.log(`[DigitalDownloaderService:polling] Terminal phase reached (${raw.phase}), stopping polling.`);
            clearInterval(interval);
            this.pollingIntervals.delete(gameId);
          }
        }
      } catch (pollErr) {
        console.warn(`[DigitalDownloaderService:polling] Error during status polling:`, pollErr);
        // continue polling
      }
    }, 1000);
    this.pollingIntervals.set(gameId, interval);
  }

  /**
   * Queries available installation options for a game from Hydra-compatible sources.
   * Returns clean, friendly options (zero mentions of torrents, magnets, or technical jargon).
   */
  async queryInstallOptions(gameName: string): Promise<Array<{ id: string; title: string; size: string; badge: string; status: string }>> {
    if (hasTauriRuntime()) {
      try {
        const res = await invoke<{ ok: boolean; options: any[] }>("query_digital_options", { name: gameName });
        if (res && res.ok && Array.isArray(res.options)) {
          return res.options.map((opt) => ({
            id: opt.id,
            title: opt.title,
            size: opt.size,
            badge: opt.badge,
            status: opt.status,
          }));
        }
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Cancels the active digital download.
   */
  async cancel(gameId: number): Promise<void> {
    if (this.pollingIntervals.has(gameId)) {
      clearInterval(this.pollingIntervals.get(gameId));
      this.pollingIntervals.delete(gameId);
    }
    const record = this.getRecord(gameId);
    const appId = record?.id ?? gameId;

    if (hasTauriRuntime()) {
      try {
        await invoke("cancel_digital_download", { appId });
      } catch {
        // Continue cleaning local state
      }
    }

    this.updateSnapshot({
      gameId,
      phase: "cancelled",
      progress: 0,
      statusText: "Descarga cancelada",
    });
  }

  /**
   * Launches the digital game by running its `playProcess` via DigitalProcessManager.
   */
  async play(game: CatalogGame): Promise<void> {
    const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
    if (record?.playProcess && record.playProcess.trim()) {
      await digitalProcessManager.executePlay(game, record);
      return;
    }
    if (hasTauriRuntime() && game.app_id) {
      await invoke("open_steam_run", { appId: game.app_id });
    }
  }

  /**
   * Uninstalls the digital game by running its `uninstallProcess` via DigitalProcessManager.
   */
  async uninstall(game: CatalogGame): Promise<void> {
    const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
    if (record?.uninstallProcess && record.uninstallProcess.trim()) {
      await digitalProcessManager.executeUninstall(game, record);
      return;
    }
    if (hasTauriRuntime() && game.app_id) {
      await invoke("uninstall_game", { appId: game.app_id });
    }
  }

  /**
   * Returns the current progress snapshot.
   */
  async getStatus(gameId: number): Promise<DownloadProgressSnapshot> {
    return this.activeJobs.get(gameId) ?? {
      gameId,
      phase: "preparing",
      progress: 0,
    };
  }

  /**
   * Returns a snapshot converted to ManagedDownloadStatus for UI rendering.
   */
  getManagedStatus(gameId: number): ManagedDownloadStatus | undefined {
    const snapshot = this.activeJobs.get(gameId);
    return snapshot ? snapshotToManagedStatus(snapshot) : undefined;
  }

  /**
   * Subscribes to real-time progress updates for a game.
   */
  subscribe(gameId: number, listener: (snapshot: DownloadProgressSnapshot) => void): () => void {
    if (!this.listeners.has(gameId)) {
      this.listeners.set(gameId, new Set());
    }
    this.listeners.get(gameId)!.add(listener);

    const current = this.activeJobs.get(gameId);
    if (current) listener(current);

    return () => {
      this.listeners.get(gameId)?.delete(listener);
    };
  }

  /**
   * Receives incoming progress updates from the Python script (via Tauri events or polling).
   */
  updateSnapshot(snapshot: DownloadProgressSnapshot): void {
    this.activeJobs.set(snapshot.gameId, snapshot);
    const subs = this.listeners.get(snapshot.gameId);
    if (subs) {
      for (const listener of subs) {
        try {
          listener(snapshot);
        } catch {
          // Prevent listener errors from breaking update loop
        }
      }
    }
    for (const listener of this.globalListeners) {
      try {
        listener(snapshot);
      } catch {
        // Prevent listener errors from breaking update loop
      }
    }
  }
}

export const digitalDownloadService = new DigitalDownloadService();
