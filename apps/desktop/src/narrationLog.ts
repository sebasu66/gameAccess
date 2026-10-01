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

const remoteErrorCooldown = new Map<string, number>();

function sanitizedRemoteError(value: string): string {
  return value
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

async function reportRemoteError(message: string, area: string): Promise<void> {
  if (!hasTauriRuntime()) return;
  const safe = sanitizedRemoteError(message);
  if (!safe) return;

  const fingerprint = `${area}|${safe}`;
  const now = Date.now();
  const previous = remoteErrorCooldown.get(fingerprint) ?? 0;
  if (now - previous < 30_000) return;
  remoteErrorCooldown.set(fingerprint, now);

  try {
    const [api, token, installationId] = await Promise.all([
      getApiBaseUrl(),
      readActivationSession(),
      getInstallationId(),
    ]);
    if (!api || !token || !installationId) return;

    const response = await fetch(`${api}/client-errors`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-GameAccess-Installation": installationId,
      },
      body: JSON.stringify({
        area,
        message: safe,
        app_id: numericContext(safe, /\bAppID\s+(\d+)\b/i),
        lease_id: numericContext(safe, /\blease\s+(\d+)\b/i),
        client_build: typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "development",
      }),
    });
    if (!response.ok) {
      console.warn("[GameAccess][REPORT] Server rejected client error report:", response.status);
    }
  } catch (error) {
    console.warn("[GameAccess][REPORT] Could not send client error report:", error);
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
  if (level === "ERROR") void reportRemoteError(clean, area);
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
    if (level === "ERROR") void reportRemoteError(message, area);
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
