import { useEffect } from "react";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { digitalErrorMessage } from "./digitalErrors";
import { libraryMembership } from "./libraryMembership";
import { reportClientError } from "./narrationLog";
import { getAppLocale, translate } from "./i18n";
import { confirmNotice, hideNotice, showNotice } from "./notice/notice";
import { noticeGame } from "./notice/noticeGame";
import { findAnotherSource } from "./sourceRescue";
import { reportBadSource } from "./catalog/gameLessons";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { localizeLauncherText } from "./launcherText";
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

const KIND_KEYS = { audio: "notAGameKindAudio", images: "notAGameKindImages", video: "notAGameKindVideo", documents: "notAGameKindDocuments", other: "notAGameKindOther" } as const;

/**
 * A failed download is told once, in the app's single notice (bottom right), never in a second dialog. Another
 * download source may work, so the notice offers "Try another source" (sourceRescue.ts checks them one by one).
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
      } else if (snapshot.errorCode === "no_space") {
        // Not the source's fault: another source would not fit either. What was downloaded stays until the player
        // decides: wait paused while making room, cancel (deletes it, after asking), or leave it as it is.
        const gameId = snapshot.gameId;
        const failed = (error: unknown) => showNotice({ tone: "error", title: translate("toastActionFailed", { error: String(error instanceof Error ? error.message : error) }) });
        showNotice({
          game: game ? noticeGame(game) : undefined, tone: "error", title: translate("toastDownloadFailed", { name }), text,
          actions: [
            { label: translate("noSpaceKeepPaused"), kind: "primary", run: () => { hideNotice(); void digitalDownloadService.holdPaused(gameId).catch(failed); } },
            { label: translate("noSpaceCancel"), kind: "danger", run: () => void confirmNotice({
              game: game ? noticeGame(game) : undefined, title: translate("noSpaceCancelTitle", { name }), text: translate("noSpaceCancelText"),
              confirmLabel: translate("noSpaceCancelConfirm"), cancelLabel: translate("noSpaceCancelBack"),
            }).then(ok => { if (ok) return digitalDownloadService.discardStopped(gameId).then(() => hideNotice()); }).catch(failed) },
            { label: translate("close"), kind: "secondary", run: () => hideNotice() },
          ],
        });
        return;
      } else void reportClientError(reportMessage, "DIGITAL_DOWNLOAD");
      // The download finished and installing it failed (unpacking or the game's own installer): its files are in the
      // game's folder, so the notice opens it, and the log says what was done and why it stopped.
      const installFailed = snapshot.resumeStep === "extract" || Boolean(snapshot.steps?.some(step => ["extract", "install"].includes(step.id) && step.state === "failed"));
      showNotice({
        game: game ? noticeGame(game) : undefined, tone: "error", title: translate(installFailed ? "toastInstallFailed" : "toastDownloadFailed", { name }), text,
        details: game ? { label: translate("noticeShowLog"), load: () => failureLog(game) } : undefined,
        actions: [
          ...(game && installFailed ? [{ label: translate("noticeOpenFolder"), kind: "primary" as const, run: () => void digitalProcessManager.openFolder(game).catch(() => digitalProcessManager.openFolder(game, "download")) }] : []),
          // The download itself worked: another source is offered only when downloading failed (one row of buttons).
          ...(game && !installFailed ? [{ label: translate("rescueTry"), kind: "primary" as const, run: () => void findAnotherSource(game) }] : []),
          { label: translate("close"), kind: "secondary", run: () => hideNotice() },
        ],
      });
    });
  }, []);
  return null;
}
