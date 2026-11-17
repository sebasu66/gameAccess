import { recordActivity } from "./activity/activity";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import type { DownloadPhase, DownloadProgressSnapshot } from "./downloadProvider";
import { translate } from "./i18n";
import { hideNotice, showNotice, updateNotice, type NoticeGame } from "./notice/notice";
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

/**
 * Each thing that happens to a download is its own entry of the activity history: added to the queue, started, and
 * ready to play or stopped (Seba, 2026-11-12: the downloads in progress are on the Downloads screen, the history only
 * tells what happened). The key starts with `download:` so the entry goes to the Downloads group.
 */
export type DownloadEvent = "queued" | "started" | "end";
let eventCount = 0;
export const downloadActivityKey = (gameId: number, event: DownloadEvent = "end") => `download:${gameId}:${event}:${Date.now()}:${eventCount++}`;
const NOTICE_TONE = { info: "info", success: "ok", warning: "error", error: "error" } as const;
const ACTIVITY_STATE = { info: "info", success: "done", warning: "failed", error: "failed" } as const;

/**
 * The notice of a download that starts (in the corner with its bar, while no other notice comes), finishes, is
 * interrupted or is cancelled, each one an entry of the activity history (docs/GUI_DESIGN.md §4.9); a download added
 * to the queue is only written in the history.
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
    const added = previous === undefined && STARTING.has(snapshot.phase);
    const notice = downloadNotice(previous, snapshot.phase);
    if (!notice && !added) return;
    const game = digitalDownloadService.getDownloads().find(entry => entry.snapshot.gameId === snapshot.gameId)?.game;
    const name = game?.name ?? `#${snapshot.gameId}`;
    const who: NoticeGame = game ? noticeGame(game) : { name, appId: snapshot.gameId };
    if (added) recordActivity({ key: downloadActivityKey(snapshot.gameId, "queued"), title: translate("activityDownloadQueued", { name }), tone: "info", state: "info",
      kind: "download", appId: who.appId ?? undefined, name, image: who.image });
    if (!notice) return;
    const started = notice.key === "toastDownloadStarted";
    const id = showNotice({
      game: who, title: translate(notice.key, { name }), tone: NOTICE_TONE[notice.tone],
      progress: started ? (snapshot.progress ?? 0) / 100 : undefined,
      // "Started" is a thing that happened, not a process: the history shows it at once.
      activity: started ? { key: downloadActivityKey(snapshot.gameId, "started"), state: "info" } : { key: downloadActivityKey(snapshot.gameId, "end"), state: ACTIVITY_STATE[notice.tone], severity: notice.tone === "warning" ? "warning" : undefined },
      ...(notice.tone === "warning" ? { actions: [{ label: translate("close"), run: () => hideNotice() }] } : {}),
    });
    if (started) live.set(snapshot.gameId, id); else live.delete(snapshot.gameId);
  });
}
