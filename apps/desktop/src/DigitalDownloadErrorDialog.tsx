import { useEffect, useState } from "react";
import AppDialog from "./AppDialog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { digitalErrorMessage } from "./digitalErrors";
import { libraryMembership } from "./libraryMembership";
import { reportClientError } from "./narrationLog";
import {useI18n} from "./i18n";
import GameRecoveryDialog from "./GameRecoveryDialog";
import type { CatalogGame } from "./types";

export type DownloadProblem = { key: string; name: string; error: string; reportMessage: string; reported: boolean | null; game?: CatalogGame;
  /** The download held no executable at all: what it held instead ("audio", "images"...). */
  notAGame?: string[] };

const KIND_KEYS = { audio: "notAGameKindAudio", images: "notAGameKindImages", video: "notAGameKindVideo", documents: "notAGameKindDocuments", other: "notAGameKindOther" } as const;

/** Not an error to retry or repair: the launcher already deleted it; the player should pick another source. */
export function NotAGameDialog({ problem, onClose }: { problem: DownloadProblem; onClose: () => void }) {
  const { t, localeTag } = useI18n();
  const kinds = (problem.notAGame?.length ? problem.notAGame : ["other"]).map(kind => t(KIND_KEYS[kind as keyof typeof KIND_KEYS] ?? "notAGameKindOther"));
  return <AppDialog title={t("notAGameTitle", { name: problem.name })} tone="info"
    message={t("notAGameBody", { kinds: new Intl.ListFormat(localeTag, { type: "conjunction" }).format(kinds) })} onClose={onClose} />;
}

export function DownloadProblemDialog({ problem, onClose }: { problem: DownloadProblem; onClose: () => void }) {
  const {t}=useI18n();
  const support = t(problem.reported === null ? "downloadSupportSending" : problem.reported ? "downloadSupportSent" : "downloadSupportFailed");
  return <AppDialog title={t("downloadProblemTitle",{name:problem.name})} tone="error"
    message={`${problem.error}\n\n${support} ${t("downloadSupportSorry")}`} onClose={onClose} />;
}

export default function DigitalDownloadErrorDialog() {
  const [problems, setProblems] = useState<DownloadProblem[]>([]);
  useEffect(() => {
    const seen = new Map<number, string>();
    let mounted = true;
    const unsubscribe = digitalDownloadService.onGlobalUpdate(snapshot => {
      // Opening the app must not greet the user with a dialog about an old failure; the library card is flagged instead.
      if (!digitalDownloadService.startedThisSession(snapshot.gameId)) return;
      if (!snapshot.error && !["error", "interrupted"].includes(snapshot.phase)) {
        seen.delete(snapshot.gameId);
        return;
      }
      const game = digitalDownloadService.getDownloads().find(entry => entry.snapshot.gameId === snapshot.gameId)?.game;
      const name = game?.name || `Juego ${snapshot.gameId}`;
      const reportMessage = digitalErrorMessage(snapshot, name);
      if (seen.get(snapshot.gameId) === reportMessage) return;
      seen.set(snapshot.gameId, reportMessage);
      const key = `${snapshot.gameId}:${Date.now()}:${reportMessage}`;
      if (snapshot.errorCode === "not_a_game") {
        // Nothing failed in Game Access: the source gave music or artwork. It is no longer in the library.
        if (game) libraryMembership.remove(game);
        setProblems(current => [...current, { key, name, game, reportMessage, error: snapshot.error ?? "", reported: true, notAGame: snapshot.errorDetail ?? [] }]);
        return;
      }
      setProblems(current => [...current, { key, name, game, reportMessage, error: snapshot.error || snapshot.statusText || "Error de ejecución", reported: null }]);
      void reportClientError(reportMessage, "DIGITAL_DOWNLOAD").then(reported => {
        if (mounted) setProblems(current => current.map(problem => problem.key === key ? { ...problem, reported } : problem));
      });
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  const problem = problems[0];
  const close = () => setProblems(current => current.slice(1));
  if (problem?.notAGame) return <NotAGameDialog key={problem.key} problem={problem} onClose={close} />;
  // With the game known, the failure is recoverable: show what failed, the editable parameters, retry or abort.
  if (problem?.game) return <GameRecoveryDialog key={problem.key} game={problem.game} mode="error" message={problem.error} onClose={close} />;
  return problem ? <DownloadProblemDialog key={problem.key} problem={problem} onClose={close} /> : null;
}
