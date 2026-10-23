import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import type { DownloadPhase, DownloadProgressSnapshot } from "./downloadProvider";
import { translate } from "./i18n";
import { notify } from "./toasts";

const STARTING: ReadonlySet<DownloadPhase> = new Set(["queued", "preparing"]);

type Notice = { key: "toastDownloadStarted" | "toastDownloadCompleted" | "toastDownloadFailed" | "toastDownloadInterrupted" | "toastDownloadCancelled"; tone: "info" | "success" | "warning" | "error" };

/**
 * Which notice a phase change deserves. `previous` is undefined the first time a game is seen: a download
 * restored at start-up (already downloading, or already finished) is not news, a new one starts queued.
 */
export function downloadNotice(previous: DownloadPhase | undefined, next: DownloadPhase): Notice | null {
  if (previous === next) return null;
  if (next === "downloading") return previous !== undefined && STARTING.has(previous) ? { key: "toastDownloadStarted", tone: "info" } : null;
  if (previous === undefined) return null;
  if (next === "completed") return { key: "toastDownloadCompleted", tone: "success" };
  if (next === "error") return { key: "toastDownloadFailed", tone: "error" };
  if (next === "interrupted") return { key: "toastDownloadInterrupted", tone: "warning" };
  if (next === "cancelled") return { key: "toastDownloadCancelled", tone: "info" };
  return null;
}

/** Raises a toast when a download starts, finishes, fails, is interrupted or is cancelled. */
export function startDownloadNotifications(): () => void {
  const phases = new Map<number, DownloadPhase>();
  for (const { snapshot } of digitalDownloadService.getDownloads()) phases.set(snapshot.gameId, snapshot.phase);
  return digitalDownloadService.onGlobalUpdate((snapshot: DownloadProgressSnapshot) => {
    const previous = phases.get(snapshot.gameId);
    phases.set(snapshot.gameId, snapshot.phase);
    const notice = downloadNotice(previous, snapshot.phase);
    if (!notice) return;
    const name = digitalDownloadService.getDownloads().find(entry => entry.snapshot.gameId === snapshot.gameId)?.game.name ?? `#${snapshot.gameId}`;
    const detail = notice.key === "toastDownloadFailed" && snapshot.error ? `: ${snapshot.error}` : "";
    notify(translate(notice.key, { name }) + detail, { tone: notice.tone, durationMs: notice.tone === "error" ? 10000 : 6000 });
  });
}
