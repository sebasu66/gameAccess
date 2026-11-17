import type { CatalogGame } from "./types";

export const CATALOG_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
export const CATALOG_REFRESH_REQUEST = "gameaccess:refresh-catalog";
export const CATALOG_REFRESH_STATUS = "gameaccess:catalog-refresh-status";
export const CATALOG_NOTICE_DURATION = 10_000;
export const CATALOG_LAST_SYNC_KEY = "gameaccess:catalog_last_sync_timestamp";
export const CATALOG_OPEN_SYNC_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export function getLastCatalogSyncTime(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    const val = localStorage.getItem(CATALOG_LAST_SYNC_KEY);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

export function recordCatalogSyncTime(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CATALOG_LAST_SYNC_KEY, String(Date.now()));
  } catch {
    // Ignore storage issues
  }
}

export function shouldSyncOnOpen(): boolean {
  const last = getLastCatalogSyncTime();
  return !last || (Date.now() - last) >= CATALOG_OPEN_SYNC_THRESHOLD_MS;
}

/** One shared refresh path for manual requests and the client timer.
 * Failures preserve the last successful baseline; disposal ignores late replies. */
export class CatalogUpdater {
  private known: Set<number>;
  private pending: Promise<void> | null = null;
  private disposed = false;
  private timer?: ReturnType<typeof setInterval>;
  private lastAttempt = Date.now();
  constructor(initial: CatalogGame[], private callbacks: {
    load: () => Promise<CatalogGame[]>;
    apply: (games: CatalogGame[]) => void;
    added: (games: CatalogGame[]) => void;
    status: (busy: boolean) => void;
    error: (error: unknown, manual: boolean) => void;
  }) { this.known = new Set(initial.map(game => game.id)); }
  start() { this.timer = setInterval(() => void this.refresh(), CATALOG_REFRESH_INTERVAL); }
  catchUp() { if (Date.now() - this.lastAttempt >= CATALOG_REFRESH_INTERVAL) void this.refresh(); }
  refresh(manual = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.lastAttempt = Date.now();
    this.callbacks.status(true);
    this.pending = Promise.resolve().then(this.callbacks.load).then(games => {
      if (this.disposed) return;
      const unique = [...new Map(games.map(game => [game.id, game])).values()];
      const added = unique.filter(game => !this.known.has(game.id));
      this.callbacks.apply(unique);
      this.known = new Set(unique.map(game => game.id));
      recordCatalogSyncTime();
      if (added.length) this.callbacks.added(added);
    }).catch(error => {
      if (!this.disposed) this.callbacks.error(error, manual);
    }).finally(() => {
      this.pending = null;
      if (!this.disposed) this.callbacks.status(false);
    });
    return this.pending;
  }
  dispose() { this.disposed = true; clearInterval(this.timer); }
}
