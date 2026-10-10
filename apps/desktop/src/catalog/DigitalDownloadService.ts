import { libraryMembership } from "../libraryMembership";
import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import { digitalErrorMessage } from "../digitalErrors";
import { supplyArchivePasswords } from "./archivePasswords";
import type { CatalogGame } from "../types";
import type { DownloadPhase, DownloadProgressSnapshot, IDownloadProvider, DownloadStartOptions } from "../downloadProvider";
import { snapshotToManagedStatus } from "../downloadProvider";
import type { ManagedDownloadStatus } from "../downloadTypes";
import { digitalProcessManager } from "./DigitalProcessManager";
import type { DigitalGameRecord } from "./DigitalCatalog";

import { getActivationTier } from "../activation";

export const isDownloadHistory = (phase: DownloadPhase) => ["completed", "error", "cancelled", "interrupted", "external"].includes(phase);
export interface DownloadSpeedSample { time: number; speedBps: number; }

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
  private queue: number[] = [];
  private running = new Set<number>();
  get maxParallelDownloads(): number { return this.tier() === "plus" ? 4 : 1; }
  private jobs = new Map<number, { game: CatalogGame; options?: DownloadStartOptions & { record?: DigitalGameRecord } }>();
  private controls = new Set<number>();
  private speeds = new Map<number, DownloadSpeedSample[]>();
  getSpeedSamples(gameId: number): readonly DownloadSpeedSample[] { return this.speeds.get(gameId) ?? []; }

  constructor(private storageKey?: string, private readonly tier: () => "base" | "plus" | null = getActivationTier) {
    if (!storageKey || typeof localStorage === "undefined") return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!saved || !Array.isArray(saved.entries)) return;
      for (const entry of saved.entries) {
        if (!entry?.game || !entry?.snapshot || typeof entry.snapshot.gameId !== "number") continue;
        if (isDownloadHistory(entry.snapshot.phase)) continue;
        const snapshot: DownloadProgressSnapshot =
          entry.snapshot.phase === "completed" && entry.snapshot.statusText?.startsWith("Abierto en navegador web.")
            ? { ...entry.snapshot, phase: "external" }
            : entry.snapshot;
        this.jobs.set(snapshot.gameId, { game: entry.game, options: entry.record ? { record: entry.record } : undefined });
        if (snapshot.phase === "downloading" && Number.isFinite(snapshot.speedBps)) {
      const time = Date.now();
      const samples = (this.speeds.get(snapshot.gameId) ?? []).filter(sample => sample.time >= time - 60000);
      const sample = { time, speedBps: Math.max(0, snapshot.speedBps ?? 0) };
      if (samples.length && time - samples[samples.length - 1].time < 500) samples[samples.length - 1] = sample;
      else samples.push(sample);
      this.speeds.set(snapshot.gameId, samples.slice(-61));
    }
    this.activeJobs.set(snapshot.gameId, snapshot);
        this.reportFailure(snapshot);
      }
      this.queue = Array.isArray(saved.queue) ? saved.queue.filter((id: number) => this.activeJobs.get(id)?.phase === "queued") : [];
      const runningIds = Array.isArray(saved.running) ? saved.running : [saved.running];
      for (const id of runningIds) {
        const active = this.activeJobs.get(id);
        if (active && !["queued", "completed", "error", "cancelled", "interrupted", "external"].includes(active.phase)) this.running.add(id);
      }
      this.persist();
      setTimeout(() => {
        if (!hasTauriRuntime()) return;
        for (const id of this.running) {
          const record = this.jobs.get(id)?.options?.record;
          this.startStatusPolling(id, record?.id ?? id);
        }
        void this.pump();
      }, 0);
    } catch { /* Invalid saved state must not block catalog startup. */ }
  }

  private persist(): void {
    if (!this.storageKey || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        queue: this.queue, running: [...this.running],
        entries: this.getDownloads().filter(entry => !isDownloadHistory(entry.snapshot.phase)).map(entry => ({ ...entry, record: this.jobs.get(entry.snapshot.gameId)?.options?.record })),
      }));
    } catch { /* Storage is best-effort; running jobs remain managed in memory. */ }
  }

  getDownloads(): Array<{ game: CatalogGame; snapshot: DownloadProgressSnapshot }> {
    return Array.from(this.jobs, ([id, job]) => ({
      game: job.game, snapshot: this.activeJobs.get(id) ?? { gameId: id, phase: "queued", progress: 0 },
    }));
  }

  /** Removing a row never removes library membership or an installed game. */
  async remove(gameId: number): Promise<void> {
    const previous = this.activeJobs.get(gameId);
    if (!previous) return;
    if (!isDownloadHistory(previous.phase)) await this.cancel(gameId);
    const current = this.activeJobs.get(gameId);
    if (this.running.has(gameId) || (current && !isDownloadHistory(current.phase))) {
      throw new Error("Espera a que termine la cancelación de la descarga.");
    }
    this.jobs.delete(gameId);
    this.activeJobs.delete(gameId);
    this.speeds.delete(gameId);
    this.queue = this.queue.filter(id => id !== gameId);
    this.persist();
    for (const listener of this.globalListeners) listener(current ?? previous);
  }

  async start(game: CatalogGame, options?: DownloadStartOptions & { record?: DigitalGameRecord }): Promise<void> {
    if (libraryMembership.isBusy()) throw new Error("Espera a que termine la operación de biblioteca.");
    const id = game.app_id ?? game.id;
    const previous = this.activeJobs.get(id);
    if (previous && !["error", "cancelled", "completed", "interrupted", "external"].includes(previous.phase)) return;
    libraryMembership.add(game);
    this.speeds.delete(id);
    this.jobs.set(id, { game, options: options ?? this.jobs.get(id)?.options });
    this.queue.push(id);
    void narrate(`Digital AppID ${id} · queued at position ${this.queue.length}; active=${this.running.size}, limit=${this.maxParallelDownloads}.`, { area: "DIGITAL_DOWNLOAD" });
    this.updateSnapshot({ gameId: id, phase: "queued", progress: 0, statusText: "En cola" });
    await this.pump();
  }

  async refreshParallelLimit(): Promise<void> { await this.pump(); }

  private async pump(): Promise<void> {
    while (this.running.size < this.maxParallelDownloads && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (!job) continue;
      // Reserve before awaiting native startup so concurrent callers share the limit.
      this.running.add(id);
      void narrate(`Digital AppID ${id} · starting queued job; active=${this.running.size}/${this.maxParallelDownloads}.`, { area: "DIGITAL_DOWNLOAD" });
      try {
        await this.launch(job.game, job.options);
      } catch (error) {
        this.updateSnapshot({ gameId: id, phase: "error", progress: 0, statusText: "No se pudo iniciar", error: String(error) });
      }
    }
  }

  async pause(gameId: number): Promise<void> {
    const phase = this.activeJobs.get(gameId)?.phase;
    if (phase === "queued") {
      this.queue = this.queue.filter(id => id !== gameId);
      this.updateSnapshot({ ...this.activeJobs.get(gameId)!, phase: "paused", statusText: "En cola · pausada" });
      return;
    }
    if (phase !== "downloading" && phase !== "preparing") return;
    await this.control(gameId, "pause");
  }

  async resume(gameId: number): Promise<void> {
    if (this.activeJobs.get(gameId)?.phase !== "paused") return;
    if (this.running.has(gameId)) {
      await this.control(gameId, "resume");
    } else {
      this.queue.push(gameId);
      this.updateSnapshot({ ...this.activeJobs.get(gameId)!, phase: "queued", statusText: "En cola" });
      await this.pump();
    }
  }

  private async control(gameId: number, action: "pause" | "resume"): Promise<void> {
    if (this.controls.has(gameId)) return;
    this.controls.add(gameId);
    try {
      const appId = this.jobs.get(gameId)?.options?.record?.id ?? this.getRecord(gameId)?.id ?? gameId;
      await invoke("control_digital_download", { appId, action });
    } catch (error) {
      void narrate(`Digital AppID ${gameId} · ${action}: ${String(error)}`, { area: "DIGITAL_DOWNLOAD", level: "ERROR" });
      throw error;
    } finally {
      this.controls.delete(gameId);
    }
  }

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
  private async launch(game: CatalogGame, options?: DownloadStartOptions & { record?: DigitalGameRecord }): Promise<void> {
    const gameId = game.app_id ?? game.id;
    const record = options?.record || this.getRecord(game.id) || this.getRecord(gameId);
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
    const installProcess = "";
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
          autoInstalled: record?.auto_installed === true,
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
      throw new Error("Las descargas Digital requieren la aplicación de escritorio.");
    }
  }

  private pollingIntervals = new Map<number, any>();

  private startStatusPolling(gameId: number, appId: number): void {
    console.log(`[DigitalDownloaderService:polling] Starting status polling for gameId=${gameId}, appId=${appId}`);
    if (this.pollingIntervals.has(gameId)) {
      clearInterval(this.pollingIntervals.get(gameId));
    }
    let pending = false;
    let passwordsSupplied = false;
    const interval = setInterval(async () => {
      if (!hasTauriRuntime() || pending || !this.running.has(gameId)) return;
      pending = true;
      try {
        const raw = await invoke<any>("digital_download_status", { appId });
        console.log(`[DigitalDownloaderService:polling] Status from Tauri for ${appId}:`, raw);
        if (!this.running.has(gameId)) return;
        if (raw?.passwordsRequired && !passwordsSupplied) {
          passwordsSupplied = true;
          await supplyArchivePasswords(appId);
        }
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
          if (["completed", "error", "cancelled", "external"].includes(raw.phase)) {
            console.log(`[DigitalDownloaderService:polling] Terminal phase reached (${raw.phase}), stopping polling.`);
            clearInterval(interval);
            this.pollingIntervals.delete(gameId);
          }
        }
      } catch (pollErr) {
        void narrate(`Digital AppID ${gameId} · consulta de estado: ${String(pollErr)}`, { area: "DIGITAL_DOWNLOAD", level: "ERROR" });
        console.warn(`[DigitalDownloaderService:polling] Error during status polling:`, pollErr);
        // Preserve the last confirmed state on a failed probe.
      } finally {
        pending = false;
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
      } catch (error) {
        void narrate(`Digital · fuentes de ${gameName}: ${String(error)}`, { area: "DIGITAL_DOWNLOAD", level: "ERROR" });
        return [];
      }
    }
    return [];
  }

  /**
   * Cancels the active digital download.
   */
  async cancel(gameId: number): Promise<void> {
    const previous = this.activeJobs.get(gameId);
    if (!previous || ["completed", "cancelled", "external"].includes(previous.phase) || this.controls.has(gameId)) return;
    this.controls.add(gameId);
    try {
      if (this.running.has(gameId)) {
        const appId = this.jobs.get(gameId)?.options?.record?.id ?? this.getRecord(gameId)?.id ?? gameId;
        this.updateSnapshot({ ...previous, phase: "cancelling", statusText: "Cancelando…" });
        try {
          const result = await invoke<{ phase: string }>("cancel_digital_download", { appId });
          if (result.phase === "completed" || this.activeJobs.get(gameId)?.phase === "completed") {
            this.updateSnapshot({ ...previous, phase: "completed", progress: 100, statusText: "Listo para jugar" });
            return;
          }
        } catch (error) {
          this.activeJobs.set(gameId, previous);
          this.updateSnapshot({ ...previous, error: String(error) });
          throw error;
        }
      } else {
        this.queue = this.queue.filter(id => id !== gameId);
      }
      this.updateSnapshot({ ...previous, phase: "cancelled", speedBps: 0, etaSeconds: undefined, statusText: "Descarga cancelada", error: null });
    } finally {
      this.controls.delete(gameId);
    }
  }

  /**
   * Launches the digital game by running its `playProcess` via DigitalProcessManager.
   */
  async play(game: CatalogGame): Promise<void> {
    const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
    await digitalProcessManager.executePlay(game, record);
  }

  hasActiveDownloads(): boolean {
    return this.getDownloads().some(({snapshot}) => !["completed", "error", "interrupted", "cancelled", "external"].includes(snapshot.phase));
  }

  async uninstall(game: CatalogGame): Promise<void> {
    const id = game.app_id ?? game.id;
    const snapshot = this.activeJobs.get(id);
    if (snapshot && !["completed", "error", "interrupted", "cancelled", "external"].includes(snapshot.phase)) {
      throw new Error("Aborte la descarga antes de desinstalar el juego.");
    }
    await digitalProcessManager.executeUninstall(game);
    this.updateSnapshot({ gameId: id, phase: "cancelled", progress: 0, statusText: "Juego desinstalado" });
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
  recordFailure(game: CatalogGame, error: string): void {
    const id = game.app_id ?? game.id;
    if (!this.jobs.has(id)) this.jobs.set(id, { game });
    this.updateSnapshot({ gameId: id, phase: "error", progress: 0, statusText: "No se pudo descargar el juego", error });
  }

  private reportFailure(snapshot: DownloadProgressSnapshot): void {
    if (!snapshot.error && !["error", "interrupted"].includes(snapshot.phase)) return;
    void narrate(digitalErrorMessage(snapshot, this.jobs.get(snapshot.gameId)?.game.name), { area: "DIGITAL_DOWNLOAD", level: "ERROR" });
  }

  updateSnapshot(snapshot: DownloadProgressSnapshot): void {
    const previous = this.activeJobs.get(snapshot.gameId);
    if (previous?.phase === "cancelling" && !["cancelled", "completed", "error"].includes(snapshot.phase)) return;
    if (previous?.phase !== snapshot.phase || previous?.error !== snapshot.error) this.reportFailure(snapshot);
    if (previous?.phase !== snapshot.phase) void narrate(`Digital AppID ${snapshot.gameId} · phase ${previous?.phase ?? "new"} -> ${snapshot.phase}; bytes=${snapshot.bytesDownloaded ?? "unknown"}/${snapshot.bytesTotal ?? "unknown"}; ${snapshot.statusText ?? ""}.`, { area: "DIGITAL_DOWNLOAD" });
    this.activeJobs.set(snapshot.gameId, snapshot);
    if (snapshot.phase === "cancelled") {
      this.jobs.delete(snapshot.gameId);
      this.queue = this.queue.filter(id => id !== snapshot.gameId);
    }
    if (["completed", "error", "cancelled", "interrupted", "external"].includes(snapshot.phase) && this.running.has(snapshot.gameId)) {
      clearInterval(this.pollingIntervals.get(snapshot.gameId));
      this.pollingIntervals.delete(snapshot.gameId);
      this.running.delete(snapshot.gameId);
      void narrate(`Digital AppID ${snapshot.gameId} · job ended (${snapshot.phase}); active=${this.running.size}, queued=${this.queue.length}; scheduler checking the next job.`, { area: "DIGITAL_DOWNLOAD" });
      queueMicrotask(() => { void this.pump(); });
    }
    this.persist();
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

export const digitalDownloadService = new DigitalDownloadService("gameaccess.digital.downloads.v1");
