import { invoke } from "@tauri-apps/api/core";
import { getInstallationId, readActivationSession } from "./activation";
import { getApiBaseUrl } from "./settings";

declare const __BUILD_TIMESTAMP__: string;

export type NarrationLevel = "INFO" | "WARN" | "ERROR";
export type NarrationOptions = {
  area?: string;
  level?: NarrationLevel;
};

const hasTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const cleanMessage = (value: string) => value.replace(/\s+/g, " ").trim();

let writeQueue: Promise<void> = Promise.resolve();
let logPathPromise: Promise<string | null> | null = null;


export function sanitizedRemoteError(value: string): string {
  return value
    .replace(/(?:https?:\/\/|magnet:\?|postgres(?:ql)?:\/\/)[^\s]+/gi, "[link]")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(password|session[_ -]?token|activation[_ -]?key|authorization|client_public_key)\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]")
    .slice(0, 4000);
}

function numericContext(message: string, pattern: RegExp): number | null {
  const match = message.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

const remoteErrorRequests = new Map<string, { time: number; promise: Promise<boolean> }>();

/**
 * Reports that could not be sent (no server yet, not activated, hosted server asleep) wait here,
 * across restarts, and go out as soon as a report gets through. Without it they were simply lost.
 */
const PENDING_REPORTS_KEY = "gameaccess:pending-client-errors";
const MAX_PENDING_REPORTS = 50;
type PendingReport = { area: string; message: string; at: string };

function readPendingReports(): PendingReport[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_REPORTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.message === "string" && typeof item.area === "string") : [];
  } catch { return []; }
}

function writePendingReports(reports: PendingReport[]): void {
  try {
    if (reports.length) localStorage.setItem(PENDING_REPORTS_KEY, JSON.stringify(reports.slice(-MAX_PENDING_REPORTS)));
    else localStorage.removeItem(PENDING_REPORTS_KEY);
  } catch { /* storage full or blocked: the report stays in the local log only */ }
}

function queueReport(area: string, message: string): void {
  const pending = readPendingReports();
  if (pending.some(item => item.area === area && item.message === message)) return;
  writePendingReports([...pending, { area, message, at: new Date().toISOString() }]);
}

let flushing: Promise<void> | null = null;
/** Sends the waiting reports in order, stopping at the first one that does not get through. */
export function flushPendingClientErrors(): Promise<void> {
  if (!hasTauriRuntime()) return Promise.resolve();
  flushing ??= (async () => {
    for (let pending = readPendingReports(); pending.length; pending = readPendingReports()) {
      const [first] = pending;
      if (await sendRemoteError(`[occurred ${first.at}] ${first.message}`, first.area) === "retry") return;
      writePendingReports(readPendingReports().filter(item => !(item.area === first.area && item.message === first.message && item.at === first.at)));
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

export function reportClientError(message: string, area: string): Promise<boolean> {
  if (!hasTauriRuntime()) return Promise.resolve(false);
  const safe = sanitizedRemoteError(message);
  if (!safe) return Promise.resolve(false);
  const fingerprint = `${area}|${safe}`;
  const existing = remoteErrorRequests.get(fingerprint);
  if (existing && Date.now() - existing.time < 30_000) return existing.promise;
  const promise = sendRemoteError(safe, area).then(outcome => {
    if (outcome === "sent") void flushPendingClientErrors(); else if (outcome === "retry") queueReport(area, safe);
    return outcome === "sent";
  });
  remoteErrorRequests.set(fingerprint, { time: Date.now(), promise });
  return promise;
}

let reportingStarted = false;
/** Uncaught exceptions and rejected promises go to the activity log and to the server; queued reports are retried. */
export function startClientErrorReporting(): void {
  if (reportingStarted || typeof window === "undefined") return;
  reportingStarted = true;
  window.addEventListener("error", event => {
    const where = event.filename ? ` at ${event.filename.split("/").pop()}:${event.lineno}:${event.colno}` : "";
    const stack = event.error instanceof Error && event.error.stack ? ` Stack: ${event.error.stack}` : "";
    void narrate(`Uncaught error: ${event.message || String(event.error)}${where}.${stack}`, { area: "UNCAUGHT", level: "ERROR" });
  });
  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason instanceof Error ? `${event.reason.message}${event.reason.stack ? ` Stack: ${event.reason.stack}` : ""}` : String(event.reason);
    void narrate(`Unhandled promise rejection: ${reason}`, { area: "UNCAUGHT", level: "ERROR" });
  });
  void flushPendingClientErrors();
  window.setInterval(() => void flushPendingClientErrors(), 60_000);
}

/** "retry": no server, not activated or a passing failure. "rejected": the server will never take this report. */
async function sendRemoteError(safe: string, area: string): Promise<"sent" | "retry" | "rejected"> {
  try {
    const [api, token, installationId] = await Promise.all([
      getApiBaseUrl(), readActivationSession(), getInstallationId(),
    ]);
    if (!api || !token || !installationId) return "retry";
    const response = await fetch(`${api}/client-errors`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-GameAccess-Installation": installationId },
      body: JSON.stringify({
        area, message: safe,
        app_id: numericContext(safe, /\bAppID\s+(\d+)\b/i),
        lease_id: numericContext(safe, /\blease\s+(\d+)\b/i),
        client_build: typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "development",
      }),
    });
    if (response.ok) return "sent";
    console.warn("[GameAccess][REPORT] Server rejected client error report:", response.status);
    return response.status >= 400 && response.status < 500 && ![401, 403, 408, 429].includes(response.status) ? "rejected" : "retry";
  } catch (error) {
    console.warn("[GameAccess][REPORT] Could not send client error report:", error);
    return "retry";
  }
}

function consoleNarration(message: string, area: string, level: NarrationLevel) {
  const prefix = `[GameAccess][${area}]`;
  if (level === "ERROR") console.error(prefix, message);
  else if (level === "WARN") console.warn(prefix, message);
  else console.log(prefix, message);
}

function queueNativeWrite(task: () => Promise<unknown>): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await task();
  }).catch((error) => {
    console.warn("[GameAccess][LOG] Could not write narration log:", error);
  });
  return writeQueue;
}

export function getNarrationLogPath(): Promise<string | null> {
  if (!hasTauriRuntime()) return Promise.resolve(null);
  logPathPromise ??= invoke<string>("narration_log_path").catch(() => null);
  return logPathPromise;
}

export function narrate(message: string, options: NarrationOptions = {}): Promise<void> {
  const clean = cleanMessage(message);
  if (!clean) return Promise.resolve();
  const area = options.area ?? "APP";
  const level = options.level ?? "INFO";
  consoleNarration(clean, area, level);
  if (level === "ERROR") void reportClientError(clean, area);
  if (!hasTauriRuntime()) return Promise.resolve();
  return queueNativeWrite(() => invoke("append_narration_log", { message: clean, area, level }));
}

export function narrateBatch(messages: string[], options: NarrationOptions = {}): Promise<void> {
  const clean = messages.map(cleanMessage).filter(Boolean);
  if (!clean.length) return Promise.resolve();
  const area = options.area ?? "APP";
  const level = options.level ?? "INFO";
  for (const message of clean) {
    consoleNarration(message, area, level);
    if (level === "ERROR") void reportClientError(message, area);
  }
  if (!hasTauriRuntime()) return Promise.resolve();
  return queueNativeWrite(() => invoke("append_narration_log_batch", { messages: clean, area, level }));
}

export async function startNarrationSession(build: string, initialMode: string): Promise<void> {
  const path = await getNarrationLogPath();
  await narrate("──────────────────────────────── NEW GAMEACCESS SESSION ────────────────────────────────", { area: "STARTUP" });
  await narrate(
    `Starting GameAccess desktop front end. Build: ${build || "development build"}. Initial catalog view: ${initialMode}.`,
    { area: "STARTUP" },
  );
  if (path) {
    await narrate(`Human-readable activity log is stored at ${path}.`, { area: "STARTUP" });
  } else {
    await narrate("Running without the native desktop logger; narration is available in the browser console only.", { area: "STARTUP", level: "WARN" });
  }
}
