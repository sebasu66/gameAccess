import { narrate, narrateBatch } from "./narrationLog";

/**
 * Flag-gated diagnostics for the desktop client.
 *
 * Tauri builds have no DevTools (F12 does nothing), so the activity console is
 * the only runtime window into the app. Everything here is routed through the
 * existing narration pipeline, which already redacts credentials.
 *
 * Enable with any of:
 *   - `?debug_log=1` in the window URL
 *   - `localStorage.setItem("gameaccess:debug_log", "true")`
 *   - Ctrl+Shift+L, or the console toggle
 *
 * Cost control: `narrate` performs one IPC write per line, so per-image tracing
 * must not be one line per image. Trace lines are buffered and flushed every
 * 500 ms, and high-volume producers emit aggregated counters instead.
 */

const STORAGE_KEY = "gameaccess:debug_log";
const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFERED_LINES = 200;

const stateListeners = new Set<(enabled: boolean) => void>();
let override: boolean | null = null;
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let droppedLines = 0;

function readFlag(): boolean {
  if (override !== null) return override;
  if (typeof window === "undefined") return false;
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true") return true;
    if (new URLSearchParams(window.location.search).get("debug_log") === "1") return true;
  } catch {
    // Storage or URL access blocked; diagnostics stay off.
  }
  return false;
}

export function debugLoggingEnabled(): boolean {
  return readFlag();
}

function flush(): void {
  flushTimer = undefined;
  if (!buffer.length) return;
  const lines = buffer;
  buffer = [];
  lines.push(...(droppedLines ? [`[DEBUG] ${droppedLines} línea(s) descartada(s) por volumen.`] : []));
  droppedLines = 0;
  void narrateBatch(lines, { area: "DEBUG" });
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  // Never hold the process open for diagnostics.
  (flushTimer as unknown as { unref?: () => void }).unref?.();
}

export function setDebugLogging(enabled: boolean): void {
  override = enabled;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Session-only in that case.
  }
  for (const listener of stateListeners) {
    try {
      listener(enabled);
    } catch {
      // Safe dispatch.
    }
  }
  // Confirmation is unconditional, so turning it off still reports.
  void narrate(`[DEBUG] diagnóstico ${enabled ? "ACTIVADO" : "desactivado"}.`, { area: "DEBUG" });
}

export function toggleDebugLogging(): boolean {
  const enabled = !readFlag();
  setDebugLogging(enabled);
  return enabled;
}

export function subscribeDebugLogging(listener: (enabled: boolean) => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function resetDebugLoggingForTests(): void {
  override = null;
  stateListeners.clear();
  buffer = [];
  droppedLines = 0;
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
}

/** Flush buffered trace lines immediately (tests and shutdown). */
export function flushDebugLog(): void {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  flush();
}

/** A single buffered trace line. Safe to call per item. */
export function debugTrace(area: string, message: string): void {
  if (!readFlag()) return;
  if (buffer.length >= MAX_BUFFERED_LINES) {
    droppedLines++;
    return;
  }
  buffer.push(`[DEBUG ${area}] ${message}`);
  scheduleFlush();
}

/** A durable diagnostic line, written immediately. Use for state changes. */
export function debugLog(area: string, message: string): void {
  if (!readFlag()) return;
  void narrate(`[DEBUG ${area}] ${message}`, { area: "DEBUG" });
}

function truncate(value: unknown, max = 120): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function debugTraceJson(area: string, label: string, payload: unknown): void {
  if (!readFlag()) return;
  debugTrace(area, `${label} ${truncate(payload)}`);
}
