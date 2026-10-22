import { DownloadQueueClient, QueueRefused, type EnqueueOrder, type QueueJob, type QueueState } from "./downloadQueueClient";

/**
 * A stand-in for the launcher's Download Manager in interface tests. It records the orders and answers with a
 * state the test controls; the queue rules themselves are tested in the launcher (tests/test_download_queue.py).
 */
export class FakeDownloadQueue extends DownloadQueueClient {
  readonly orders: Array<{ action: string; appId?: number; body?: unknown }> = [];
  readonly jobs = new Map<number, QueueJob>();
  tier: "base" | "plus" | null = "base";
  failNext: Error | null = null;

  constructor() {
    super(async () => { throw new Error("the fake answers every order itself"); });
  }

  set(appId: number, phase: string, status: Record<string, unknown> = {}, extra: Partial<QueueJob> = {}): void {
    const job = this.jobs.get(appId);
    if (job) Object.assign(job, { phase, status: { ...job.status, ...status, phase }, route: String(status.route ?? job.route ?? "") }, extra);
  }

  private answer(): QueueState {
    if (this.failNext) { const error = this.failNext; this.failNext = null; throw error; }
    return { tier: this.tier, limit: this.tier === "plus" ? 4 : this.tier ? 1 : 0, running: 0, jobs: [...this.jobs.values()].map(job => ({ ...job })) };
  }

  override async state(): Promise<QueueState> { return this.answer(); }
  override async configure(tier: "base" | "plus" | null, chunkSession: string | null): Promise<QueueState> {
    this.orders.push({ action: "configure", body: { tier, chunkSession } });
    this.tier = tier;
    return this.answer();
  }
  override async enqueue(order: EnqueueOrder): Promise<QueueState> {
    this.orders.push({ action: "enqueue", appId: order.appId, body: order });
    if (this.failNext) return this.answer();
    if (this.tier !== "plus" && /^https?:/i.test(order.source) && !/\.torrent/i.test(order.source)) throw new QueueRefused("El modo gratuito descarga solo por torrent.");
    this.jobs.set(order.appId, { appId: order.appId, name: order.name, phase: "queued", state: "waiting", position: this.jobs.size, error: "", status: {}, route: "" });
    return this.answer();
  }
  private order(action: string, appId: number, phase?: string): Promise<QueueState> {
    this.orders.push({ action, appId });
    if (phase) this.set(appId, phase);
    return Promise.resolve().then(() => this.answer());
  }
  override pause(appId: number) { return this.order("pause", appId, "paused"); }
  override async suspend(): Promise<QueueState> {
    this.orders.push({ action: "suspend" });
    this.tier = null;
    for (const job of this.jobs.values()) if (!["completed", "error", "cancelled", "interrupted"].includes(job.phase)) this.set(job.appId, "paused");
    return this.answer();
  }
  override resume(appId: number) { return this.order("resume", appId, "queued"); }
  override cancel(appId: number) { return this.order("cancel", appId, "cancelled"); }
  override move(appId: number, delta: -1 | 1) { this.orders.push({ action: "move", appId, body: delta }); return Promise.resolve(this.answer()); }
  override remove(appId: number) { this.orders.push({ action: "remove", appId }); this.jobs.delete(appId); return Promise.resolve(this.answer()); }
}
