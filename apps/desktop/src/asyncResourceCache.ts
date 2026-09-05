export interface CacheOptions {
  ttlMs: number;
  now?: () => number;
}

type ResolvedEntry<V> = { value: V; expiresAt: number };

/** Shared result + in-flight cache. Rejected loads are never cached. */
export class AsyncResourceCache<K, V> {
  private readonly resolved = new Map<K, ResolvedEntry<V>>();
  private readonly pending = new Map<K, Promise<V>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: CacheOptions) {
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  peek(key: K): V | undefined {
    const entry = this.resolved.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.resolved.delete(key);
      return undefined;
    }
    return entry.value;
  }

  get(key: K, loader: () => Promise<V>): Promise<V> {
    const cached = this.peek(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    let request: Promise<V>;
    request = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.resolved.set(key, { value, expiresAt: this.now() + this.ttlMs });
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }

  invalidate(key: K): void {
    this.resolved.delete(key);
  }

  clear(): void {
    this.resolved.clear();
  }

  hasInFlight(key: K): boolean {
    return this.pending.has(key);
  }
}

/**
 * A deduplicating single-flight scheduler for expensive native estimates.
 * At most one heavy task runs at a time; duplicate keys share the same promise.
 */
export class SingleFlightScheduler<K, V> {
  private running = false;
  private readonly inFlight = new Map<K, Promise<V>>();
  private readonly queue: Array<{ key: K; task: () => Promise<V>; resolve: (value: V) => void; reject: (reason: unknown) => void }> = [];

  request(key: K, task: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = new Promise<V>((resolve, reject) => {
      this.queue.push({ key, task, resolve, reject });
      this.pump();
    });
    this.inFlight.set(key, promise);
    promise.finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }).catch(() => undefined);
    return promise;
  }

  private pump(): void {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    void next.task().then(next.resolve, next.reject).finally(() => {
      this.running = false;
      this.pump();
    });
  }

  queuedCount(): number {
    return this.queue.length;
  }
}
