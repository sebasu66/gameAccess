import { invoke } from "@tauri-apps/api/core";

/**
 * Talks to the launcher's Download Manager (game_download_manager/queue_service.py), the single owner of the
 * download queue: which downloads run, wait, pause or resume, BASE 1 / PLUS 4. The app only sends orders and
 * shows the state it returns; it keeps no queue rules of its own.
 */

export interface QueueJob {
  appId: number;
  name: string;
  /** What the player sees: queued, paused, preparing, downloading, ..., completed, error, cancelled, interrupted. */
  phase: string;
  /** waiting | active | paused | cancelling | done */
  state: string;
  /** Position in the queue (0 = next to start), -1 when not waiting. */
  position: number;
  error: string;
  /** The worker's own status (progress, bytes, speed, statusText, route). */
  status: Record<string, unknown>;
  route: string;
}

export interface QueueState {
  tier: "base" | "plus" | null;
  limit: number;
  running: number;
  jobs: QueueJob[];
}

export interface EnqueueOrder {
  appId: number;
  name: string;
  source: string;
  delivery?: string;
  autoInstalled?: boolean;
  keepArchive?: boolean;
  /** The download as its source names it, and where it came from: kept with the install. */
  sourceTitle?: string;
  sourceProvider?: string;
}

/** The Download Manager refused an order; the message is meant for the player. */
export class QueueRefused extends Error {}

type Relay = (path: string, body: unknown) => Promise<{ status: number; data: unknown }>;

/** Rust relays every request to the local Download Manager (no cross-origin request; the session token stays native). */
const nativeRelay: Relay = (path, body) => invoke("download_queue_request", { path, body: body === undefined ? null : body });

export class DownloadQueueClient {
  constructor(private readonly relay: Relay = nativeRelay) {}

  private async request(path: string, body?: unknown): Promise<QueueState> {
    const { status, data } = await this.relay(path, body);
    const answer = (data ?? {}) as QueueState & { error?: string };
    if (status === 409) throw new QueueRefused(answer.error || "La descarga fue rechazada.");
    if (status < 200 || status >= 300) throw new Error(answer.error || `Download Manager: ${status}`);
    return answer;
  }

  state(): Promise<QueueState> { return this.request("/state"); }
  configure(tier: "base" | "plus" | null, chunkSession: string | null): Promise<QueueState> {
    return this.request("/config", { tier, chunkSession });
  }
  enqueue(order: EnqueueOrder): Promise<QueueState> { return this.request("/jobs", order); }
  /** The activation ended: every pending download pauses and nothing starts until a plan is configured again. */
  suspend(): Promise<QueueState> { return this.request("/suspend", {}); }
  pause(appId: number): Promise<QueueState> { return this.request(`/jobs/${appId}/pause`, {}); }
  resume(appId: number): Promise<QueueState> { return this.request(`/jobs/${appId}/resume`, {}); }
  cancel(appId: number): Promise<QueueState> { return this.request(`/jobs/${appId}/cancel`, {}); }
  remove(appId: number): Promise<QueueState> { return this.request(`/jobs/${appId}/remove`, {}); }
  move(appId: number, delta: -1 | 1): Promise<QueueState> { return this.request(`/jobs/${appId}/move`, { delta }); }
}
