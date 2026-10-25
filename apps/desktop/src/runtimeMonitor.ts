import { resourceGuard } from "./ResourceGuard";
import { takeRenderSummary } from "./RenderProbe";

export interface RuntimeReading {
  fps: number;
  /** Share of the last window the main thread spent in tasks longer than 50 ms (0..100). */
  busyPercent: number;
  worstFrameMs: number;
  heapMb: number | null;
  /** Heaviest scripts of the window, e.g. "index-abc.js:renderCards 420ms". */
  culprits: string[];
  /** Components that rendered the most in the window. */
  renders: string[];
}

export const RUNTIME_LIMITS = {
  WINDOW_MS: 3000,
  BUSY_WARN_PERCENT: 35,
  FRAME_WARN_MS: 120,
  MIN_FPS_WHEN_ACTIVE: 24,
} as const;

type Listener = (reading: RuntimeReading) => void;

/**
 * Watches how heavy the app is while it runs: main-thread long tasks (CPU), frame
 * pace and JS memory. It reports to ResourceGuard, whose alarm only sounds when the
 * profiler is on. Dev builds turn that on by default (see ResourceGuard.isDebugEnabled).
 */
export function startRuntimeMonitor(onReading?: Listener): () => void {
  if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") return () => undefined;
  let frames = 0, worst = 0, longMs = 0, last = performance.now(), windowStart = last, raf = 0, stopped = false;
  let observer: PerformanceObserver | null = null;
  let frameObserver: PerformanceObserver | null = null;
  const scripts = new Map<string, number>();
  try {
    observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longMs += entry.duration; });
    observer.observe({ entryTypes: ["longtask"] });
  } catch { observer = null; /* longtask is not offered everywhere */ }
  try {
    frameObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as unknown as Array<{ scripts?: Array<{ sourceURL?: string; sourceFunctionName?: string; invoker?: string; duration: number }> }>) {
        for (const s of entry.scripts ?? []) {
          const file = (s.sourceURL ?? "").split("/").pop()?.split("?")[0] || "?";
          const key = `${file}:${s.sourceFunctionName || s.invoker || "anon"}`;
          scripts.set(key, (scripts.get(key) ?? 0) + s.duration);
        }
      }
    });
    frameObserver.observe({ type: "long-animation-frame", buffered: false } as PerformanceObserverInit);
  } catch { frameObserver = null; /* not offered everywhere */ }
  const tick = (now: number) => {
    if (stopped) return;
    if (document.visibilityState === "visible") {
      const delta = now - last;
      // A hidden or just-resumed window produces one huge gap; it is not slowness.
      if (delta < 2000) { frames++; if (delta > worst) worst = delta; }
    }
    last = now;
    const elapsed = now - windowStart;
    if (elapsed >= RUNTIME_LIMITS.WINDOW_MS) {
      const heap = resourceGuard.getMetrics().heapUsedMb;
      const reading: RuntimeReading = {
        fps: Math.round(frames * 1000 / elapsed), busyPercent: Math.min(100, Math.round(longMs * 100 / elapsed)),
        worstFrameMs: Math.round(worst), heapMb: heap,
        renders: takeRenderSummary(),
        culprits: [...scripts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, ms]) => `${name} ${Math.round(ms)}ms`),
      };
      onReading?.(reading);
      if (document.visibilityState === "visible" && document.hasFocus()) {
        if (reading.busyPercent >= RUNTIME_LIMITS.BUSY_WARN_PERCENT)
          resourceGuard.triggerAlert("CPU_BUSY", `The interface was busy ${reading.busyPercent}% of the last ${Math.round(elapsed / 1000)} s (long tasks).`, reading as unknown as Record<string, unknown>);
        if (reading.worstFrameMs >= RUNTIME_LIMITS.FRAME_WARN_MS)
          resourceGuard.triggerAlert("FRAME_DROP", `A frame took ${reading.worstFrameMs} ms (${reading.fps} fps average).`, reading as unknown as Record<string, unknown>);
      }
      resourceGuard.checkMemory();
      frames = 0; worst = 0; longMs = 0; windowStart = now; scripts.clear();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); observer?.disconnect(); frameObserver?.disconnect(); };
}
