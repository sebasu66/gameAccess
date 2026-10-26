import { useEffect } from "react";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { digitalErrorMessage } from "./digitalErrors";
import { libraryMembership } from "./libraryMembership";
import { reportClientError } from "./narrationLog";
import { getAppLocale, translate } from "./i18n";
import { hideNotice, showNotice } from "./notice/notice";
import { noticeGame } from "./notice/noticeGame";
import { findAnotherSource } from "./sourceRescue";
import { reportBadSource } from "./catalog/gameLessons";

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
      } else void reportClientError(reportMessage, "DIGITAL_DOWNLOAD");
      showNotice({
        game: game ? noticeGame(game) : undefined, tone: "error", title: translate("toastDownloadFailed", { name }), text,
        actions: [
          ...(game ? [{ label: translate("rescueTry"), kind: "primary" as const, run: () => void findAnotherSource(game) }] : []),
          { label: translate("close"), kind: "secondary", run: () => hideNotice() },
        ],
      });
    });
  }, []);
  return null;
}
