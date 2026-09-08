import { invoke } from "@tauri-apps/api/core";

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
  if (!hasTauriRuntime()) return Promise.resolve();
  return queueNativeWrite(() => invoke("append_narration_log", { message: clean, area, level }));
}

export function narrateBatch(messages: string[], options: NarrationOptions = {}): Promise<void> {
  const clean = messages.map(cleanMessage).filter(Boolean);
  if (!clean.length) return Promise.resolve();
  const area = options.area ?? "APP";
  const level = options.level ?? "INFO";
  for (const message of clean) consoleNarration(message, area, level);
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
