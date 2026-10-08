import { useEffect, useState } from "react";
import AppDialog from "./AppDialog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { digitalErrorMessage } from "./digitalErrors";
import { reportClientError } from "./narrationLog";
import {useI18n} from "./i18n";

export type DownloadProblem = { key: string; name: string; error: string; reportMessage: string; reported: boolean | null };

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
      if (!snapshot.error && !["error", "interrupted"].includes(snapshot.phase)) {
        seen.delete(snapshot.gameId);
        return;
      }
      const name = digitalDownloadService.getDownloads().find(entry => entry.snapshot.gameId === snapshot.gameId)?.game.name || `Juego ${snapshot.gameId}`;
      const reportMessage = digitalErrorMessage(snapshot, name);
      if (seen.get(snapshot.gameId) === reportMessage) return;
      seen.set(snapshot.gameId, reportMessage);
      const key = `${snapshot.gameId}:${Date.now()}:${reportMessage}`;
      setProblems(current => [...current, { key, name, reportMessage, error: snapshot.error || snapshot.statusText || "Error de ejecución", reported: null }]);
      void reportClientError(reportMessage, "DIGITAL_DOWNLOAD").then(reported => {
        if (mounted) setProblems(current => current.map(problem => problem.key === key ? { ...problem, reported } : problem));
      });
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  const problem = problems[0];
  return problem ? <DownloadProblemDialog key={problem.key} problem={problem} onClose={() => setProblems(current => current.slice(1))} /> : null;
}
