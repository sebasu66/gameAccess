import { libraryMembership } from "../libraryMembership";
import { translate } from "../i18n";
import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import { buildChunkSession, canAccelerate } from "../vikingResolver";
import { initialDownloadMethod, methodFromRoute, type DownloadMethod } from "../downloadMethod";
import { digitalErrorMessage } from "../digitalErrors";
import type { CatalogGame } from "../types";
import type { DownloadPhase, DownloadProgressSnapshot, DownloadStepDone, DownloadStepId, DownloadStepNow, IDownloadProvider, DownloadStartOptions } from "../downloadProvider";
import { snapshotToManagedStatus } from "../downloadProvider";
import type { ManagedDownloadStatus } from "../downloadTypes";
import { digitalProcessManager } from "./DigitalProcessManager";
import type { DigitalGameRecord } from "./DigitalCatalog";
import { DownloadQueueClient, QueueRefused, type QueueJob, type QueueState } from "./downloadQueueClient";

import { getActivationTier } from "../activation";

export const isDownloadHistory = (phase: DownloadPhase) => ["completed", "error", "cancelled", "interrupted", "external"].includes(phase);
export interface DownloadSpeedSample { time: number; speedBps: number; }

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const PHASES: readonly DownloadPhase[] = ["queued", "preparing", "downloading", "paused", "decompressing", "installing",
  "cancelling", "cancelled", "interrupted", "external", "completed", "error"];
const POLL_MS = 1000;

type JobOptions = DownloadStartOptions & { record?: DigitalGameRecord };

/**
 * The app's view of the downloads. The launcher's Download Manager owns the queue (which downloads run, wait,
 * pause or resume, BASE 1 / PLUS 4, the order, what resumes after a restart); this service sends it orders and
 * turns its state into snapshots for the interface. What stays here is what only the interface needs: the game
 * shown in each row, speed history, notices, the desktop shortcut after a download completes.
 */

const STEP_IDS: readonly string[] = ["route", "probe", "server", "download", "extract", "install"];
/** The launcher's current step, if it is well formed. */
function stepNow(value: unknown): DownloadStepNow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { id?: unknown; detail?: unknown; startedAt?: unknown };
  return STEP_IDS.includes(String(raw.id)) ? { id: raw.id as DownloadStepId, detail: String(raw.detail ?? ""), startedAt: Number(raw.startedAt) || Date.now() } : null;
}
/** The launcher's finished steps, keeping only well-formed ones. */
function stepsDone(value: unknown): DownloadStepDone[] {
  if (!Array.isArray(value)) return [];
  return value.filter(raw => raw && STEP_IDS.includes(String(raw.id)) && ["done", "skipped", "failed"].includes(String(raw.state)))
    .map(raw => ({ id: raw.id, state: raw.state, result: String(raw.result ?? ""), ms: Number(raw.ms) || 0 }));
}

export class DigitalDownloadService implements IDownloadProvider {
  readonly name = "digital-python-downloader";
  private activeJobs = new Map<number, DownloadProgressSnapshot>();
  private listeners = new Map<number, Set<(snapshot: DownloadProgressSnapshot) => void>>();
  private globalListeners = new Set<(snapshot: DownloadProgressSnapshot) => void>();
  private shortcutCreated = new Set<number>();
  private jobs = new Map<number, { game: CatalogGame; options?: JobOptions }>();
  /** The Download Manager keys downloads by AppID; rows are keyed by game id. Usually the same number. */
  private appIds = new Map<number, number>();
  private positions = new Map<number, number>();
  private lastState: QueueState | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private speeds = new Map<number, DownloadSpeedSample[]>();
  /** Games whose download was started in this session. A failure found in state restored at startup is not announced with a dialog. */
  private readonly startedNow = new Set<number>();
  startedThisSession(gameId: number): boolean { return this.startedNow.has(gameId); }
  private readonly methods = new Map<number, DownloadMethod>();
  /** How this game is being fetched (shown as a pill), or undefined when not known. */
  getDownloadMethod(gameId: number): DownloadMethod | undefined { return this.methods.get(gameId); }
  getSpeedSamples(gameId: number): readonly DownloadSpeedSample[] { return this.speeds.get(gameId) ?? []; }
  get maxParallelDownloads(): number { return this.lastState?.limit ?? (this.plan() === "plus" ? 4 : 1); }
  /** The plan downloads run under (shown as a pill). Without a key the app is in free mode, which is BASE: one
   *  download at a time, torrents only. */
  planTier(): "base" | "plus" { return this.plan(); }
  private plan(): "base" | "plus" { return this.tier() === "plus" ? "plus" : "base"; }

  constructor(
    private storageKey?: string,
    private readonly tier: () => "base" | "plus" | null = getActivationTier,
    private readonly queue: DownloadQueueClient = new DownloadQueueClient(),
  ) {
    this.restoreRows();
    if (!hasTauriRuntime()) return;
    setTimeout(() => { void this.syncConfig().finally(() => this.ensurePolling()); }, 0);
  }

  // ---------------------------------------------------------------- rows kept for the interface
  private restoreRows(): void {
    if (!this.storageKey || typeof localStorage === "undefined") return;
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) || "null");
      if (!saved || !Array.isArray(saved.entries)) return;
      for (const entry of saved.entries) {
        if (!entry?.game || !entry?.snapshot || typeof entry.snapshot.gameId !== "number") continue;
        if (isDownloadHistory(entry.snapshot.phase)) continue;
        const id = entry.snapshot.gameId;
        this.jobs.set(id, { game: entry.game, options: entry.record ? { record: entry.record } : undefined });
        if (typeof entry.appId === "number") this.appIds.set(id, entry.appId);
        this.activeJobs.set(id, entry.snapshot);
        this.reportFailure(entry.snapshot);
      }
    } catch { /* Invalid saved rows must not block catalog startup. */ }
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistSoon(): void {
    if (this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persist(); }, 4000);
  }

  private persist(): void {
    if (this.persistTimer !== null) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    if (!this.storageKey || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        entries: this.getDownloads().filter(entry => !isDownloadHistory(entry.snapshot.phase)).map(entry => ({
          ...entry, record: this.jobs.get(entry.snapshot.gameId)?.options?.record, appId: this.appIds.get(entry.snapshot.gameId),
        })),
      }));
    } catch { /* Storage is best-effort; the Download Manager keeps the real queue. */ }
  }

  getDownloads(): Array<{ game: CatalogGame; snapshot: DownloadProgressSnapshot }> {
    return Array.from(this.jobs, ([id, job]) => ({
      game: job.game, snapshot: this.activeJobs.get(id) ?? { gameId: id, phase: "queued", progress: 0 },
    }));
  }

  private appIdOf(gameId: number): number { return this.appIds.get(gameId) ?? gameId; }
  private gameIdOf(appId: number): number {
    for (const [gameId, mapped] of this.appIds) if (mapped === appId) return gameId;
    return appId;
  }

  // ---------------------------------------------------------------- the Download Manager's state
  private ensurePolling(): void {
    if (this.pollTimer !== null || !hasTauriRuntime()) return;
    this.pollTimer = setInterval(() => { void this.sync(); }, POLL_MS);
  }

  /** Reads the Download Manager's state once and shows it. */
  async sync(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      this.apply(await this.queue.state());
    } catch (error) {
      void narrate(`Download Manager unavailable: ${String(error)}`, { area: "DIGITAL_DOWNLOAD", level: "WARN" });
    } finally {
      this.polling = false;
    }
  }

  private async syncConfig(): Promise<void> {
    const tier = this.plan();
    try {
      const session = tier === "plus" && hasTauriRuntime() ? await buildChunkSession() : null;
      this.apply(await this.queue.configure(tier, session));
    } catch (error) {
      void narrate(`Could not tell the Download Manager the plan: ${String(error)}`, { area: "DIGITAL_DOWNLOAD", level: "WARN" });
    }
  }

  private snapshotOf(gameId: number, job: QueueJob): DownloadProgressSnapshot {
    const status = job.status ?? {};
    const phase = (PHASES as readonly string[]).includes(job.phase) ? job.phase as DownloadPhase : "preparing";
    const number = (key: string) => typeof status[key] === "number" ? status[key] as number : undefined;
    const text = phase === "queued" ? translate("dlsQueued")
      : phase === "paused" ? translate("dlsUserPaused")
      : String(status.statusText ?? "") || (phase === "preparing" ? translate("dlsStartingManager") : "");
    return {
      gameId, phase,
      progress: number("progressPercent") ?? 0,
      downloadPercent: number("downloadPercent"),
      installPercent: number("installPercent"),
      statusText: text,
      bytesDownloaded: number("bytesDownloaded") ?? 0,
      bytesTotal: number("totalBytes") ?? 0,
      speedBps: phase === "downloading" ? number("speedBps") ?? 0 : 0,
      etaSeconds: phase === "downloading" ? number("etaSeconds") ?? 0 : 0,
      error: job.error || undefined,
      errorCode: typeof status.errorCode === "string" ? status.errorCode : undefined,
      errorDetail: Array.isArray(status.errorDetail) ? status.errorDetail.map(String) : undefined,
      ...("step" in status || "steps" in status ? { step: stepNow(status.step), steps: stepsDone(status.steps) } : {}),
    };
  }

  private apply(state: QueueState): void {
    this.lastState = state;
    const seen = new Set<number>();
    for (const job of state.jobs ?? []) {
      const gameId = this.gameIdOf(job.appId);
      seen.add(gameId);
      this.appIds.set(gameId, job.appId);
      this.positions.set(gameId, job.position);
      if (!this.jobs.has(gameId)) this.jobs.set(gameId, { game: { id: gameId, app_id: job.appId, name: job.name } as CatalogGame });
      const route = methodFromRoute(job.route);
      if (route) this.methods.set(gameId, route);
      const next = this.snapshotOf(gameId, job);
      const previous = this.activeJobs.get(gameId);
      if (!previous || previous.phase !== next.phase || previous.progress !== next.progress || previous.bytesDownloaded !== next.bytesDownloaded
        || previous.statusText !== next.statusText || previous.error !== next.error || previous.speedBps !== next.speedBps
        || previous.step?.id !== next.step?.id || previous.step?.detail !== next.step?.detail || previous.steps?.length !== next.steps?.length) {
        this.updateSnapshot(next);
      }
    }
    // A row the Download Manager does not know (it was lost, for example a queue from an older version) cannot resume.
    for (const [gameId, snapshot] of this.activeJobs) {
      if (seen.has(gameId) || isDownloadHistory(snapshot.phase) || !this.appIds.has(gameId)) continue;
      this.updateSnapshot({ ...snapshot, phase: "interrupted", speedBps: 0, statusText: translate("dlsLost"), error: translate("dlsLost") });
    }
    for (const gameId of this.positions.keys()) if (!seen.has(gameId)) this.positions.delete(gameId);
  }

  // ---------------------------------------------------------------- orders
  async start(game: CatalogGame, options?: JobOptions): Promise<void> {
    if (libraryMembership.isBusy()) throw new Error("Espera a que termine la operación de biblioteca.");
    const id = game.app_id ?? game.id;
    const size = game.download_size_bytes;
    if (hasTauriRuntime() && size != null && Number.isFinite(size) && size > 0) {
      // The Library Manager refuses a download whose unpacking would not fit; an unreadable check never blocks.
      const room = await digitalProcessManager.librarySpace(size).then(result => result.space, () => undefined);
      if (room && !room.ok) throw new Error(room.message);
    }
    const previous = this.activeJobs.get(id);
    if (previous && !isDownloadHistory(previous.phase)) return;
    if (!hasTauriRuntime()) throw new Error("Las descargas Digital requieren la aplicación de escritorio.");
    this.startedNow.add(id);
    libraryMembership.add(game);
    this.speeds.delete(id);
    const jobOptions = options ?? this.jobs.get(id)?.options;
    this.jobs.set(id, { game, options: jobOptions });
    const record = jobOptions?.record || this.getRecord(game.id) || this.getRecord(id);
    const appId = record?.id ?? game.app_id ?? id;
    this.appIds.set(id, appId);
    const name = record?.name ?? game.name;
    const source = (record?.downloadSource ?? (game as { downloadSource?: string }).downloadSource ?? "").trim();
    if (!source) {
      const error = `El juego '${name}' no posee fuentes de descarga disponibles.`;
      this.updateSnapshot({ gameId: id, phase: "error", progress: 0, statusText: translate("dlsNoSources"), error });
      throw new Error(error);
    }
    // PLUS can have a source accelerated by the server: the Download Manager needs the session to ask for it.
    let accelerated = false;
    if (this.plan() === "plus" && canAccelerate(source)) {
      const session = await buildChunkSession();
      if (session) {
        accelerated = true;
        this.apply(await this.queue.configure("plus", session));
        void narrate(`Descarga por fragmentos disponible para ${name}; el Download Manager elige la ruta.`, { area: "DOWNLOAD" });
      }
    }
    this.methods.set(id, initialDownloadMethod(source, accelerated));
    this.updateSnapshot({ gameId: id, phase: "queued", progress: 0, statusText: translate("dlsQueued") });
    try {
      this.apply(await this.queue.enqueue({
        appId, name, source, delivery: accelerated ? "download" : record?.sourceDelivery ?? "download",
        autoInstalled: record?.auto_installed === true, keepArchive: jobOptions?.keepArchive,
        sourceTitle: record?.sourceTitle, sourceProvider: record?.sourceProvider,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateSnapshot({ gameId: id, phase: "error", progress: 0,
        statusText: error instanceof QueueRefused ? message : translate("dlsStartProcessError"), error: message });
      throw error;
    }
    this.ensurePolling();
  }

  async refreshParallelLimit(): Promise<void> {
    await this.syncConfig();
  }

  /** PLUS ended: what was downloading pauses and the app goes on in free mode (BASE). The player can resume a
   *  torrent; a direct link needs PLUS again (the Download Manager says so). */
  async suspendForAccessEnd(): Promise<void> {
    this.apply(await this.queue.suspend());
    this.apply(await this.queue.configure("base", null));
  }

  async pause(gameId: number): Promise<void> {
    const phase = this.activeJobs.get(gameId)?.phase;
    if (!phase || isDownloadHistory(phase) || phase === "paused" || phase === "cancelling") return;
    this.apply(await this.queue.pause(this.appIdOf(gameId)));
  }

  async resume(gameId: number): Promise<void> {
    if (this.activeJobs.get(gameId)?.phase !== "paused") return;
    this.apply(await this.queue.resume(this.appIdOf(gameId)));
  }

  /** Moves a queued download earlier (-1) or later (+1); the first ones start first. */
  moveInQueue(gameId: number, delta: -1 | 1): void {
    void this.queue.move(this.appIdOf(gameId), delta).then(state => this.apply(state), error => {
      void narrate(`Could not reorder the queue: ${String(error)}`, { area: "DIGITAL_DOWNLOAD", level: "WARN" });
    });
  }

  /** Position of a queued download (0 = next to start), or -1. */
  queuePosition(gameId: number): number { return this.positions.get(gameId) ?? -1; }

  private cancelling = new Set<number>();
  async cancel(gameId: number): Promise<void> {
    const previous = this.activeJobs.get(gameId);
    if (!previous || ["completed", "cancelled", "external"].includes(previous.phase) || this.cancelling.has(gameId)) return;
    this.cancelling.add(gameId);
    try {
      this.apply(await this.queue.cancel(this.appIdOf(gameId)));
    } finally {
      this.cancelling.delete(gameId);
    }
  }

  /** Removing a row never removes library membership or an installed game. */
  async remove(gameId: number): Promise<void> {
    const previous = this.activeJobs.get(gameId);
    if (!previous) return;
    if (!isDownloadHistory(previous.phase)) await this.cancel(gameId);
    const current = this.activeJobs.get(gameId);
    if (current && !isDownloadHistory(current.phase)) throw new Error("Espera a que termine la cancelación de la descarga.");
    await this.queue.remove(this.appIdOf(gameId)).catch(() => undefined);
    this.forget(gameId, current ?? previous);
  }

  private forget(gameId: number, last: DownloadProgressSnapshot): void {
    this.jobs.delete(gameId);
    this.activeJobs.delete(gameId);
    this.speeds.delete(gameId);
    this.methods.delete(gameId);
    this.positions.delete(gameId);
    this.persist();
    for (const listener of this.globalListeners) listener(last);
  }

  onGlobalUpdate(listener: (snapshot: DownloadProgressSnapshot) => void): () => void {
    this.globalListeners.add(listener);
    return () => { this.globalListeners.delete(listener); };
  }

  private digitalRecords = new Map<number, DigitalGameRecord>();

  /** Registers or updates digital catalog records from digital_catalog.json. */
  registerRecords(records: DigitalGameRecord[]): void {
    for (const record of records) {
      if (record && typeof record.id === "number") this.digitalRecords.set(record.id, record);
    }
  }

  getRecord(gameId: number): DigitalGameRecord | undefined {
    return this.digitalRecords.get(gameId);
  }

  canHandle(game: CatalogGame): boolean {
    return Boolean(game.id || game.app_id);
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
          return res.options.map((opt) => ({ id: opt.id, title: opt.title, size: opt.size, badge: opt.badge, status: opt.status }));
        }
      } catch (error) {
        void narrate(`Digital · fuentes de ${gameName}: ${String(error)}`, { area: "DIGITAL_DOWNLOAD", level: "ERROR" });
        return [];
      }
    }
    return [];
  }

  /** Launches the digital game by running its `playProcess` via DigitalProcessManager. */
  async play(game: CatalogGame): Promise<void> {
    const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
    await digitalProcessManager.executePlay(game, record);
  }

  hasActiveDownloads(): boolean {
    return this.getDownloads().some(({ snapshot }) => !isDownloadHistory(snapshot.phase));
  }

  async uninstall(game: CatalogGame): Promise<{ folder?: string }> {
    const id = game.app_id ?? game.id;
    const snapshot = this.activeJobs.get(id);
    if (snapshot && !isDownloadHistory(snapshot.phase)) throw new Error("Aborte la descarga antes de desinstalar el juego.");
    const result = await digitalProcessManager.executeUninstall(game);
    this.updateSnapshot({ gameId: id, phase: "cancelled", progress: 0, statusText: translate("dlsUninstalled") });
    return { folder: result?.folder };
  }

  async getStatus(gameId: number): Promise<DownloadProgressSnapshot> {
    return this.activeJobs.get(gameId) ?? { gameId, phase: "preparing", progress: 0 };
  }

  getManagedStatus(gameId: number): ManagedDownloadStatus | undefined {
    const snapshot = this.activeJobs.get(gameId);
    return snapshot ? snapshotToManagedStatus(snapshot) : undefined;
  }

  subscribe(gameId: number, listener: (snapshot: DownloadProgressSnapshot) => void): () => void {
    if (!this.listeners.has(gameId)) this.listeners.set(gameId, new Set());
    this.listeners.get(gameId)!.add(listener);
    const current = this.activeJobs.get(gameId);
    if (current) listener(current);
    return () => { this.listeners.get(gameId)?.delete(listener); };
  }

  /** A download that failed before reaching the Download Manager (preparing its source, for example). */
  recordFailure(game: CatalogGame, error: string): void {
    const id = game.app_id ?? game.id;
    if (!this.jobs.has(id)) this.jobs.set(id, { game });
    this.updateSnapshot({ gameId: id, phase: "error", progress: 0, statusText: translate("dlsDownloadFailed"), error });
  }

  private reportFailure(snapshot: DownloadProgressSnapshot): void {
    if (!snapshot.error && !["error", "interrupted"].includes(snapshot.phase)) return;
    void narrate(digitalErrorMessage(snapshot, this.jobs.get(snapshot.gameId)?.game.name), { area: "DIGITAL_DOWNLOAD", level: "ERROR" });
  }

  updateSnapshot(snapshot: DownloadProgressSnapshot): void {
    const previous = this.activeJobs.get(snapshot.gameId);
    if (previous?.phase !== snapshot.phase || previous?.error !== snapshot.error) this.reportFailure(snapshot);
    if (previous?.phase !== snapshot.phase) void narrate(`Digital AppID ${snapshot.gameId} · phase ${previous?.phase ?? "new"} -> ${snapshot.phase}; bytes=${snapshot.bytesDownloaded ?? "unknown"}/${snapshot.bytesTotal ?? "unknown"}; ${snapshot.statusText ?? ""}.`, { area: "DIGITAL_DOWNLOAD" });
    if (snapshot.phase === "downloading" && Number.isFinite(snapshot.speedBps)) {
      const time = Date.now();
      const samples = (this.speeds.get(snapshot.gameId) ?? []).filter(sample => sample.time >= time - 60000);
      const sample = { time, speedBps: Math.max(0, snapshot.speedBps ?? 0) };
      if (samples.length && time - samples[samples.length - 1].time < 500) samples[samples.length - 1] = sample;
      else samples.push(sample);
      this.speeds.set(snapshot.gameId, samples.slice(-61));
    }
    this.activeJobs.set(snapshot.gameId, snapshot);
    if (snapshot.phase === "completed" && previous?.phase !== "completed" && hasTauriRuntime() && !this.shortcutCreated.has(snapshot.gameId)) {
      const game = this.jobs.get(snapshot.gameId)?.game;
      if (game) {
        this.shortcutCreated.add(snapshot.gameId);
        void digitalProcessManager.status(game).then(status => {
          if (status.installed) return invoke("create_game_shortcut", { appId: game.app_id ?? game.id, name: game.name });
        }).catch(error => {
          this.shortcutCreated.delete(snapshot.gameId);
          void narrate("No se pudo crear el acceso directo: " + String(error), { area: "SHORTCUT", level: "ERROR" });
        });
      }
    }
    if (snapshot.phase === "cancelled") {
      // A cancelled download leaves the list (the Download Manager forgets it too).
      this.jobs.delete(snapshot.gameId);
      if (previous && previous.phase !== "cancelled") void this.queue.remove(this.appIdOf(snapshot.gameId)).catch(() => undefined);
    }
    // Progress ticks arrive every second per download; the stored rows only have to survive a restart,
    // so they are written at phase changes and otherwise every few seconds.
    if (previous?.phase !== snapshot.phase) this.persist();
    else this.persistSoon();
    for (const listener of this.listeners.get(snapshot.gameId) ?? []) {
      try { listener(snapshot); } catch { /* a listener error must not break the update loop */ }
    }
    for (const listener of this.globalListeners) {
      try { listener(snapshot); } catch { /* a listener error must not break the update loop */ }
    }
  }
}

export const digitalDownloadService = new DigitalDownloadService("gameaccess.digital.downloads.v1");
