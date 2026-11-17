import { useEffect } from "react";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { digitalErrorMessage } from "./digitalErrors";
import { libraryMembership } from "./libraryMembership";
import { reportClientError } from "./narrationLog";
import { getAppLocale, translate } from "./i18n";
import { hideNotice, showNotice, type NoticeInput } from "./notice/notice";
import { recordActivity } from "./activity/activity";
import { getAppScreen } from "./appScreen";
import { manageGame } from "./manageGame";
import { downloadActivityKey } from "./downloadNotifications";
import { noticeGame } from "./notice/noticeGame";
import { reportBadSource } from "./catalog/gameLessons";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { localizeLauncherText } from "./launcherText";
import { addReadyGameToLibrary } from "./libraryMembership";
import type { CatalogGame } from "./types";

/** The game's log: its steps up to the error and, when its installer ran, why that installer stopped. */
async function failureLog(game: CatalogGame): Promise<string> {
  const result = await digitalProcessManager.gameLog(game);
  const steps = localizeLauncherText(result.log || "").trim();
  const installer = (result.installer_log || "").trim();
  const parts = [steps || translate("noticeLogEmpty")];
  if (installer) parts.push("", translate("noticeInstallerLog"), installer);
  return parts.join("\n");
}

/**
 * «Arreglado manualmente» (Seba, 2026-11-04): the player fixed the folder by hand (unpacked the archive with its
 * password, ran the installer). Game Access takes the folder as it is now (library action `manual_fixed`: nothing is
 * unpacked again) and goes on with the next step, the run check (verify-run), telling how it went.
 */
async function fixedByHand(game: CatalogGame) {
  const appId = game.app_id ?? game.id;
  showNotice({ game: noticeGame(game), tone: "info", title: translate("manualFixChecking", { name: game.name }), activity: false });
  try {
    const result = await digitalProcessManager.libraryBatch("manual_fixed", [appId]);
    const row = ((result as { results?: Array<{ ok: boolean; error?: string }> }).results ?? [])[0];
    if (!row?.ok) {
      showNotice({ game: noticeGame(game), tone: "error", title: translate("manualFixNotReady", { name: game.name }), text: localizeLauncherText(row?.error ?? ""),
        actions: [{ label: translate("noticeOpenFolder"), kind: "primary", run: () => void digitalProcessManager.openFolder(game) }, { label: translate("close"), kind: "secondary", run: () => hideNotice() }] });
      return;
    }
    addReadyGameToLibrary(appId, game.name);
    void digitalDownloadService.sync();
    showNotice({ game: noticeGame(game), tone: "info", title: translate("manualFixVerifying", { name: game.name }), activity: false });
    const verified = await digitalProcessManager.verifyRun(game);
    const check = verified.check;
    const ok = check?.state === "checked";
    showNotice({ game: noticeGame(game), tone: ok ? "ok" : "error", title: translate(ok ? "manualFixDone" : "manualFixCantRun", { name: game.name }),
      text: ok ? "" : localizeLauncherText(check?.detail || verified.skipped || ""), actions: [{ label: translate("close"), kind: "secondary", run: () => hideNotice() }] });
  } catch (error) {
    showNotice({ game: noticeGame(game), tone: "error", title: translate("toastActionFailed", { error: String(error instanceof Error ? error.message : error) }) });
  }
}

/** The failure notice shown for each download, so acting on it in Library › Downloads closes it. */
const failureNotices = new Map<number, number>();

/** The player decided in Library › Downloads: the notice about the same failure goes away (one control, not two). */
export function closeDownloadFailureNotice(gameId: number): void {
  const id = failureNotices.get(gameId);
  failureNotices.delete(gameId);
  if (id !== undefined) hideNotice(id);
}

/**
 * A download that failed is decided in one place, Library › Downloads (Seba, 2026-11-16): retry (accelerated or
 * normal), try another source, abort. The notice only tells it and takes there; with Downloads already on screen there
 * is no notice at all, only its entry in the activity history.
 */
function tellDownloadFailure(gameId: number, notice: NoticeInput): void {
  if (getAppScreen() === "downloads") {
    const activity = notice.activity || undefined;
    recordActivity({ key: activity?.key, title: notice.title, text: notice.text, tone: notice.tone, state: activity?.state ?? "failed",
      appId: notice.game?.appId ?? undefined, name: notice.game?.name, image: notice.game?.image });
    return;
  }
  failureNotices.set(gameId, showNotice({ ...notice, actions: [
    { label: translate("pendingDownloadsOpen"), kind: "primary", run: () => { closeDownloadFailureNotice(gameId); manageGame(undefined, gameId); } },
    { label: translate("close"), kind: "secondary", run: () => closeDownloadFailureNotice(gameId) },
  ] }));
}

const KIND_KEYS = { audio: "notAGameKindAudio", images: "notAGameKindImages", video: "notAGameKindVideo", documents: "notAGameKindDocuments", other: "notAGameKindOther" } as const;

/**
 * A failed download is told once, in the app's single notice (bottom right), never in a second dialog, and decided in
 * Library › Downloads (tellDownloadFailure). A failed install (the download worked) keeps its folder and manual-fix
 * buttons in the notice.
 * The failure is still reported to support in the background. A download that held no game (music, artwork) is
 * taken out of the library, and the notice says what it held.
 */
export default function DigitalDownloadErrorDialog() {
  useEffect(() => {
    const seen = new Map<number, string>();
    return digitalDownloadService.onGlobalUpdate(snapshot => {
      // Opening the app must not greet the user with a notice about an old failure; the library card is flagged instead.
      if (!digitalDownloadService.startedThisSession(snapshot.gameId)) return;
      if (!snapshot.error && !["error", "interrupted"].includes(snapshot.phase)) {
        if (snapshot.phase !== "preparing") seen.delete(snapshot.gameId);
        return;
      }
      const game = digitalDownloadService.getDownloads().find(entry => entry.snapshot.gameId === snapshot.gameId)?.game;
      const name = game?.name || `#${snapshot.gameId}`;
      const reportMessage = digitalErrorMessage(snapshot, name);
      if (seen.get(snapshot.gameId) === reportMessage) return;
      seen.set(snapshot.gameId, reportMessage);
      let text = snapshot.error || snapshot.statusText || "";
      if (snapshot.errorCode === "not_a_game") {
        // Nothing failed in Game Access: the source gave music or artwork. It is no longer in the library.
        if (game) libraryMembership.remove(game);
        // So it does not happen to the next player: kept here at once and reported by its fingerprint in the background.
        const record = digitalDownloadService.getRecord(snapshot.gameId) ?? (game ? digitalDownloadService.getRecord(game.id) : undefined);
        void reportBadSource({ fingerprint: record?.sourceFingerprint, url: record?.downloadSource, reason: "not_a_game",
          appId: record?.id ?? game?.app_id ?? snapshot.gameId, detail: snapshot.errorDetail });
        const kinds = (snapshot.errorDetail?.length ? snapshot.errorDetail : ["other"]).map(kind => translate(KIND_KEYS[kind as keyof typeof KIND_KEYS] ?? "notAGameKindOther"));
        text = translate("notAGameBody", { kinds: new Intl.ListFormat(getAppLocale() === "es" ? "es-AR" : "en-US", { type: "conjunction" }).format(kinds) });
      } else if (snapshot.errorCode === "steam_install") {
        // A free Steam game Steam would not give through DepotDownloader (or no Steam here): Steam's own install is
        // offered in Library › Downloads, beside the retry.
        tellDownloadFailure(snapshot.gameId, { game: game ? noticeGame(game) : undefined, tone: "error", title: translate("toastDownloadFailed", { name }), text,
          activity: { key: downloadActivityKey(snapshot.gameId, "end"), state: "failed" } });
        return;
      } else if (snapshot.errorCode === "no_space") {
        // Not the source's fault: another source would not fit either. What was downloaded stays until the player
        // decides in Library › Downloads: retry once there is room, or abort (deletes it, after asking).
        tellDownloadFailure(snapshot.gameId, { game: game ? noticeGame(game) : undefined, tone: "error", title: translate("toastDownloadFailed", { name }), text,
          activity: { key: downloadActivityKey(snapshot.gameId, "end"), state: "failed" } });
        return;
      } else void reportClientError(reportMessage, "DIGITAL_DOWNLOAD");
      // The download finished and installing it failed (unpacking or the game's own installer): its files are in the
      // game's folder, so the notice opens it, and the log says what was done and why it stopped.
      const installFailed = snapshot.resumeStep === "extract" || Boolean(snapshot.steps?.some(step => ["extract", "install"].includes(step.id) && step.state === "failed"));
      if (!installFailed) {
        tellDownloadFailure(snapshot.gameId, { game: game ? noticeGame(game) : undefined, tone: "error", title: translate("toastDownloadFailed", { name }), text,
          activity: { key: downloadActivityKey(snapshot.gameId, "end"), state: "failed" },
          details: game ? { label: translate("noticeShowLog"), load: () => failureLog(game) } : undefined });
        return;
      }
      // Installing failed after the download worked: the folder and the manual fix are things to do outside Game Access.
      failureNotices.set(snapshot.gameId, showNotice({
        game: game ? noticeGame(game) : undefined, tone: "error", title: translate("toastInstallFailed", { name }), text,
        activity: { key: downloadActivityKey(snapshot.gameId, "end"), state: "failed" },
        details: game ? { label: translate("noticeShowLog"), load: () => failureLog(game) } : undefined,
        actions: [
          ...(game ? [{ label: translate("noticeOpenFolder"), kind: "primary" as const, run: () => void digitalProcessManager.openFolder(game).catch(() => digitalProcessManager.openFolder(game, "download")) }] : []),
          ...(game ? [{ label: translate("manualFixButton"), title: translate("manualFixTip"), kind: "secondary" as const, run: () => void fixedByHand(game) }] : []),
          { label: translate("close"), kind: "secondary", run: () => hideNotice() },
        ],
      }));
    });
  }, []);
  return null;
}
