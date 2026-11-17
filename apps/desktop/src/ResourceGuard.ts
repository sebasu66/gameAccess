import { narrate } from "./narrationLog";
import * as uiSounds from "./uiSounds";

export interface ResourceGuardMetrics {
  mountedCards: number;
  activeTasks: number;
  heapUsedMb: number | null;
  debugEnabled: boolean;
}

export const RESOURCE_LIMITS = {
  MAX_DOM_CARDS: 72,
  // The legitimate steady-state baseline is the artwork queue's own 6 slots
  // (libraryCoverResolver MAX_CONCURRENT) plus the source-availability scan.
  // At 6 this alarm fired continuously during normal browsing, which hid real
  // spikes; 8 leaves headroom above the baseline while still catching growth.
  MAX_CONCURRENT_FETCHES: 8,
  MAX_PENDING_QUEUE: 40,
  HEAP_WARN_MB: 512,
} as const;

class ResourceGuardManager {
  public readonly MAX_DOM_CARDS = RESOURCE_LIMITS.MAX_DOM_CARDS;
  private mountedCards = 0;
  private activeTasks = new Set<string>();
  /** Highest value seen per alert type, so the siren only marks new highs. */
  private metricPeaks = new Map<string, number>();
  private alertListeners = new Set<(event: { type: string; message: string; metrics: ResourceGuardMetrics }) => void>();
  private debugListeners = new Set<(enabled: boolean) => void>();
  private debugOverride: boolean | null = null;

  public isDebugEnabled(): boolean {
    if (this.debugOverride !== null) return this.debugOverride;
    if (typeof window === "undefined") return false;
    // During development the profiler starts on, so slowness is caught while building.
    // An explicit choice (the toggle) still wins.
    if (import.meta.env?.DEV && import.meta.env?.MODE !== "test" && this.storedChoice() === null) return true;
    const globalFlag = (window as unknown as { __GA_DEBUG_PROFILER__?: boolean }).__GA_DEBUG_PROFILER__;
    if (typeof globalFlag === "boolean") return globalFlag;
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("gameaccess:debug_profiler") === "true") {
        return true;
      }
      if (typeof window.location !== "undefined" && new URLSearchParams(window.location.search).get("debug_profiler") === "1") {
        return true;
      }
    } catch {
      // Storage access blocked or restricted.
    }
    return false;
  }

  private storedChoice(): boolean | null {
    try {
      const value = typeof localStorage !== "undefined" ? localStorage.getItem("gameaccess:debug_profiler") : null;
      return value === "true" ? true : value === "false" ? false : null;
    } catch { return null; }
  }

  public setDebugEnabled(enabled: boolean): void {
    this.debugOverride = enabled;
    if (typeof window !== "undefined") {
      (window as unknown as { __GA_DEBUG_PROFILER__?: boolean }).__GA_DEBUG_PROFILER__ = enabled;
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("gameaccess:debug_profiler", enabled ? "true" : "false");
        }
      } catch {
        // Storage access blocked.
      }
    }
    void narrate(`Resource profiler debug mode ${enabled ? "ACTIVATED" : "DEACTIVATED"}.`, { area: "RESOURCE_GUARD" });
    for (const listener of this.debugListeners) {
      try {
        listener(enabled);
      } catch {
        // Safe dispatch.
      }
    }
  }

  /** Observe the profiler flag so the UI can show whether alarms are audible. */
  public subscribeDebug(listener: (enabled: boolean) => void): () => void {
    this.debugListeners.add(listener);
    return () => {
      this.debugListeners.delete(listener);
    };
  }

  public toggleDebug(): boolean {
    const enabled = !this.isDebugEnabled();
    this.setDebugEnabled(enabled);
    return enabled;
  }

  public getMetrics(): ResourceGuardMetrics {
    let heapUsedMb: number | null = null;
    if (typeof performance !== "undefined") {
      const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
      if (typeof memory?.usedJSHeapSize === "number") {
        heapUsedMb = Math.round(memory.usedJSHeapSize / (1024 * 1024));
      }
    }
    return {
      mountedCards: this.mountedCards,
      activeTasks: this.activeTasks.size,
      heapUsedMb,
      debugEnabled: this.isDebugEnabled(),
    };
  }

  /**
   * The alarm is a growth siren, not a per-alert beep: it sounds only when a
   * metric sets a new high. Scrolling at a constant card count stays quiet,
   * while an escalating leak keeps warning. Returns the metric that grew, so
   * an unchanged count silences the tone without hiding the log entry.
   */
  private grew(type: string, metrics: ResourceGuardMetrics): boolean {
    const metric = type === "DOM_CARD_SPIKE" || type === "DOM_OVERFLOW_ATTEMPT"
      ? metrics.mountedCards
      : type === "MEMORY_SPIKE"
        ? metrics.heapUsedMb
        : type === "ASYNC_CONCURRENCY_SPIKE"
          ? metrics.activeTasks
          : null;
    if (typeof metric !== "number") return true;
    const previous = this.metricPeaks.get(type);
    if (previous !== undefined && metric <= previous) return false;
    this.metricPeaks.set(type, metric);
    return true;
  }

  public triggerAlert(type: string, message: string, details?: Record<string, unknown>): void {
    const metrics = this.getMetrics();
    console.warn(`[RESOURCE GUARD] ${type}: ${message}`, { ...details, metrics });
    void narrate(`[RESOURCE GUARD] ${type}: ${message}`, { area: "RESOURCE_GUARD", level: "WARN" });

    for (const listener of this.alertListeners) {
      try {
        listener({ type, message, metrics });
      } catch {
        // Safe dispatch.
      }
    }

    if (this.isDebugEnabled() && this.grew(type, metrics)) {
      // The tone owns its own rate limit (uiSounds.playResourceAlertTone).
      // Throttling here as well silently swallowed alerts: a scroll burst emits
      // many spikes per second, so only one could ever pass the 3 s gate.
      uiSounds.playResourceAlertTone(true);
    }
  }

  /**
   * Enforces the hard DOM cards limit. Even if an unoptimized caller requests
   * thousands of cards, this clamps the window to MAX_DOM_CARDS and triggers an alert.
   */
  public clampCardWindow(requestedCount: number, source = "catalog"): number {
    if (requestedCount > RESOURCE_LIMITS.MAX_DOM_CARDS) {
      this.triggerAlert(
        "DOM_OVERFLOW_ATTEMPT",
        `Requested ${requestedCount} cards from ${source}, exceeding safety limit of ${RESOURCE_LIMITS.MAX_DOM_CARDS}. Clamping to ${RESOURCE_LIMITS.MAX_DOM_CARDS}.`,
        { requestedCount, limit: RESOURCE_LIMITS.MAX_DOM_CARDS, source },
      );
      return RESOURCE_LIMITS.MAX_DOM_CARDS;
    }
    return Math.max(0, requestedCount);
  }

  public trackMountedCards(count: number, source = "catalog"): void {
    this.mountedCards = count;
    if (count > RESOURCE_LIMITS.MAX_DOM_CARDS) {
      this.triggerAlert(
        "DOM_CARD_SPIKE",
        `Mounted cards spiked to ${count} from ${source} (exceeds limit ${RESOURCE_LIMITS.MAX_DOM_CARDS}).`,
        { count, limit: RESOURCE_LIMITS.MAX_DOM_CARDS, source },
      );
    }
    this.checkMemory();
  }

  public registerAsyncTask(taskId: string, category = "general"): () => void {
    this.activeTasks.add(taskId);
    if (this.activeTasks.size > RESOURCE_LIMITS.MAX_CONCURRENT_FETCHES) {
      this.triggerAlert(
        "ASYNC_CONCURRENCY_SPIKE",
        `Active asynchronous tasks (${this.activeTasks.size}) exceeded limit (${RESOURCE_LIMITS.MAX_CONCURRENT_FETCHES}).`,
        { activeCount: this.activeTasks.size, category, taskId },
      );
    }
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.activeTasks.delete(taskId);
      }
    };
  }

  public checkMemory(): void {
    const metrics = this.getMetrics();
    if (metrics.heapUsedMb && metrics.heapUsedMb > RESOURCE_LIMITS.HEAP_WARN_MB) {
      this.triggerAlert(
        "MEMORY_SPIKE",
        `JS heap usage reached ${metrics.heapUsedMb} MB (warning threshold: ${RESOURCE_LIMITS.HEAP_WARN_MB} MB).`,
        { heapUsedMb: metrics.heapUsedMb, limit: RESOURCE_LIMITS.HEAP_WARN_MB },
      );
    }
  }

  public onAlert(callback: (event: { type: string; message: string; metrics: ResourceGuardMetrics }) => void): () => void {
    this.alertListeners.add(callback);
    return () => this.alertListeners.delete(callback);
  }

  public resetForTesting(): void {
    this.mountedCards = 0;
    this.activeTasks.clear();
    this.alertListeners.clear();
    this.debugListeners.clear();
    this.metricPeaks.clear();
    this.debugOverride = null;
  }
}

export const resourceGuard = new ResourceGuardManager();
