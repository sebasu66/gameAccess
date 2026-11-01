import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import type { DownloadPhase, DownloadProgressSnapshot } from "./downloadProvider";
import { translate } from "./i18n";
import { hideNotice, showNotice, updateNotice } from "./notice/notice";
import { noticeGame } from "./notice/noticeGame";

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
  // A failure has its own notice with "Try another source" (DigitalDownloadErrorDialog): no second one here.
  if (next === "error") return null;
  if (next === "interrupted") return { key: "toastDownloadInterrupted", tone: "warning" };
  if (next === "cancelled") return { key: "toastDownloadCancelled", tone: "info" };
  return null;
}

/** A download's one entry in the activity history (started, downloading, then ready or stopped). */
export const downloadActivityKey = (gameId: number) => `download:${gameId}`;
const NOTICE_TONE = { info: "info", success: "ok", warning: "error", error: "error" } as const;
const ACTIVITY_STATE = { info: "info", success: "done", warning: "failed", error: "failed" } as const;

/**
 * The notice of a download that starts (in the corner with its bar, while no other notice comes), finishes, is
 * interrupted or is cancelled; all of them are the same entry of the activity history (docs/GUI_DESIGN.md §4.9).
 */
export function startDownloadNotifications(): () => void {
  const phases = new Map<number, DownloadPhase>();
  // The notice showing each download's bar, while it is still the one in the corner.
  const live = new Map<number, number>();
  for (const { snapshot } of digitalDownloadService.getDownloads()) phases.set(snapshot.gameId, snapshot.phase);
  return digitalDownloadService.onGlobalUpdate((snapshot: DownloadProgressSnapshot) => {
    const previous = phases.get(snapshot.gameId);
    phases.set(snapshot.gameId, snapshot.phase);
    const liveId = live.get(snapshot.gameId);
    if (liveId !== undefined && previous === snapshot.phase) updateNotice(liveId, { progress: Math.max(0, Math.min(1, (snapshot.progress ?? 0) / 100)) });
    const notice = downloadNotice(previous, snapshot.phase);
    if (!notice) return;
    const game = digitalDownloadService.getDownloads().find(entry => entry.snapshot.gameId === snapshot.gameId)?.game;
    const name = game?.name ?? `#${snapshot.gameId}`;
    const started = notice.key === "toastDownloadStarted";
    const id = showNotice({
      game: game ? noticeGame(game) : { name, appId: snapshot.gameId }, title: translate(notice.key, { name }), tone: NOTICE_TONE[notice.tone],
      progress: started ? (snapshot.progress ?? 0) / 100 : undefined,
      activity: { key: downloadActivityKey(snapshot.gameId), state: started ? "running" : ACTIVITY_STATE[notice.tone] },
      ...(notice.tone === "warning" ? { actions: [{ label: translate("close"), run: () => hideNotice() }] } : {}),
    });
    if (started) live.set(snapshot.gameId, id); else live.delete(snapshot.gameId);
  });
}
