/**
 * Self-update of the desktop app. Only builds released from main (`VITE_GAMEACCESS_CHANNEL=release`, set by the
 * release workflow) look for updates; dev builds never replace themselves with a release.
 *
 * The update is mandatory: when GitHub's latest.json offers a newer signed version it is downloaded, installed and
 * the app restarts. Only when the check itself fails (no network) does the current version keep running.
 */

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "downloading"; version: string; done: number; total: number }
  | { kind: "installing"; version: string }
  | { kind: "failed"; version: string; error: string };

export type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export interface AvailableUpdate {
  version: string;
  downloadAndInstall(onEvent: (event: DownloadEvent) => void): Promise<void>;
}

export interface UpdateDeps {
  check(): Promise<AvailableUpdate | null>;
  relaunch(): Promise<void>;
  log(message: string, level?: "INFO" | "WARN"): void;
  /** Tells the player a new version was found; the download starts when this resolves (they closed the notice). */
  announce?(version: string): Promise<void>;
}

export const CHECK_TIMEOUT_MS = 15_000;

export function updatesEnabled(channel: string | undefined, tauri: boolean): boolean {
  return tauri && channel === "release";
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Looks for an update and, if there is one, installs it and restarts. Resolves when the app may go on. */
export async function runUpdate(deps: UpdateDeps, onPhase: (phase: UpdatePhase) => void): Promise<void> {
  let update: AvailableUpdate | null;
  try {
    update = await withTimeout(deps.check(), CHECK_TIMEOUT_MS);
  } catch (error) {
    deps.log(`Update check failed; this version keeps running: ${error instanceof Error ? error.message : String(error)}`, "WARN");
    onPhase({ kind: "idle" });
    return;
  }
  if (!update) {
    onPhase({ kind: "idle" });
    return;
  }
  const version = update.version;
  deps.log(`Update ${version} found; downloading and installing it before the app can be used.`);
  await deps.announce?.(version);
  let done = 0;
  let total = 0;
  onPhase({ kind: "downloading", version, done, total });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") done += event.data.chunkLength;
      if (event.event === "Finished") onPhase({ kind: "installing", version });
      else onPhase({ kind: "downloading", version, done, total });
    });
    deps.log(`Update ${version} installed; restarting.`);
    onPhase({ kind: "installing", version });
    await deps.relaunch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log(`Update ${version} could not be installed: ${message}`, "WARN");
    onPhase({ kind: "failed", version, error: message });
  }
}
