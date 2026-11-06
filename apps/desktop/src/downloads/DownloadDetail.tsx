import { useState } from "react";
import { ArrowDownToLine, FolderOpen, Pause, Play, Plus, RotateCcw, X } from "lucide-react";
import type { DigitalDownloadService } from "../catalog/DigitalDownloadService";
import { DigitalDownloadThumb } from "../DigitalDownloadArtwork";
import { digitalProcessManager } from "../catalog/DigitalProcessManager";
import { downloadPhaseLabel, eta } from "../DigitalDownloadsScreen";
import { downloadBars } from "../downloadBars";
import { downloadMethodLabel, planLabel } from "../downloadMethod";
import type { DownloadProgressSnapshot } from "../downloadProvider";
import { formatDownloadBytes, sourceDownloadSize } from "../downloadSize";
import DownloadSpeedSpark from "../DownloadSpeedSpark";
import { STEP_TITLES } from "../DownloadSteps";
import { downloadSteps, formatElapsed, transferStarted, type StepView } from "../downloadStepModel";
import { useI18n } from "../i18n";
import type { RowAction, RowStat } from "../library-manager/RowExpand";
import { confirmNotice } from "../notice/notice";
import { noticeGame } from "../notice/noticeGame";
import { notify } from "../toasts";
import type { CatalogGame } from "../types";
import "../digital-downloads.css";

export type DownloadEntry = { game: CatalogGame; snapshot: DownloadProgressSnapshot };

const DOWNLOAD_STEPS = ["route", "probe", "server", "download"];
const INSTALL_STEPS = ["extract", "install"];
/** The install runs once the download is over: unpacking (the install of a portable game) and the last checks. */
export const installing = (snapshot: DownloadProgressSnapshot) => ["decompressing", "installing"].includes(snapshot.phase);

/**
 * A download (or the install that follows it) in its game's open row (library-manager/RowExpand.tsx): the picture
 * with the speed drawn over it while it downloads and the bar at its base; the figures (done, speed, time left, how
 * much of the total); and its buttons: pause or resume, cancel, and retry only after a failure. Download and install
 * are two processes: once the download is over the picture shows the install's progress, without the speed.
 * Null when there is no download.
 */
export function useDownloadView(entry: DownloadEntry | undefined, service: DigitalDownloadService): { artTitle: string; art: JSX.Element; progress: number | null; stats: RowStat[]; actions: RowAction[] } | null {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  if (!entry) return null;
  const { game, snapshot } = entry;
  const { phase, gameId } = snapshot;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (error) { notify(`${t("downloadsActionFailed")} ${error instanceof Error ? error.message : String(error)}`, { tone: "error" }); }
    finally { setBusy(false); }
  };
  const bars = downloadBars(snapshot);
  const install = installing(snapshot);
  const started = transferStarted(snapshot);
  const stopped = phase === "error" || phase === "interrupted";
  const method = service.getDownloadMethod?.(gameId);
  const methodText = method ? downloadMethodLabel(method, locale) : null;
  const tier = service.planTier?.();
  const plan = tier ? planLabel(tier, locale) : null;
  const position = service.queuePosition?.(gameId) ?? -1;
  const total = (snapshot.bytesTotal ?? 0) > 0 ? formatDownloadBytes(snapshot.bytesTotal, locale) : sourceDownloadSize(game, locale) || t("downloadsSizeUnknown");
  const percent = install ? bars.install : started ? bars.download : typeof snapshot.checkPercent === "number" ? snapshot.checkPercent : null;

  const artTitle = install ? t("logInstall") : phase === "queued" && position >= 0 ? `${downloadPhaseLabel(phase, locale)} · ${position + 1}` : downloadPhaseLabel(phase, locale);
  const art = <div className="ga-dl-card-art lm-download-art">
    <DigitalDownloadThumb game={game} />
    {phase === "downloading" ? <DownloadSpeedSpark samples={service.getSpeedSamples(gameId)} speedBps={snapshot.speedBps} /> : null}
    {plan || methodText ? <span className="ga-dl-card-badges">
      {plan ? <span className={`ga-dl-badge plan-${tier}`} title={`${plan.label} · ${plan.hint}`} aria-label={`${plan.label}: ${plan.hint}`}><ArrowDownToLine size={14} aria-hidden="true" /></span> : null}
      {method === "accelerated" && methodText ? <span className="ga-dl-badge route-accelerated" title={methodText.hint} aria-label={`${methodText.label}: ${methodText.hint}`}><Plus size={13} strokeWidth={3} aria-hidden="true" /></span> : null}
    </span> : null}
  </div>;
  // Shown as values only, at the picture's base (the percentage is the ring over it): downloaded of the total, time
  // left and speed; while installing, the size alone.
  const stats: RowStat[] = install ? [
    { label: t("downloadsSize"), value: total },
  ] : [
    { label: t("downloadsDownloaded"), value: started || (snapshot.bytesDownloaded ?? 0) > 0 ? `${formatDownloadBytes(snapshot.bytesDownloaded, locale)} / ${total}` : total },
    { label: t("downloadsRemaining"), value: eta(snapshot) },
    ...(phase === "downloading" ? [{ label: t("downloadsSpeed"), value: `${formatDownloadBytes(snapshot.speedBps, locale)}/s` }] : []),
  ];
  const cancel = () => void confirmNotice({ game: noticeGame(game), title: t("cancelDownloadTitle", { name: game.name }), text: t("cancelDownloadBody"), confirmLabel: t("downloadsCancel"), cancelLabel: t("keepDownloading") })
    .then(ok => { if (ok) void run(() => service.cancel(gameId)); });
  const actions: RowAction[] = [
    ...(["queued", "preparing", "downloading"].includes(phase) ? [{ label: t("downloadsPause"), icon: <Pause size={14} aria-hidden="true" />, disabled: busy, onClick: () => void run(() => service.pause(gameId)) }] : []),
    ...(phase === "paused" ? [{ label: t("downloadsResume"), icon: <Play size={14} aria-hidden="true" />, tone: "accent" as const, disabled: busy, onClick: () => void run(() => service.resume(gameId)) }] : []),
    // Only after a failure: it goes on from the step it reached (unpacking again, or the rest of the download).
    ...(stopped ? [{ label: t("downloadsRetry"), icon: snapshot.resumeStep ? <Play size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />, tone: "accent" as const, disabled: busy, onClick: () => void run(() => service.retry(game)) }] : []),
    { label: t("downloadsCancel"), icon: <X size={14} aria-hidden="true" />, tone: "danger", disabled: busy || phase === "cancelling", onClick: cancel },
    { label: t("noticeOpenFolder"), icon: <FolderOpen size={14} aria-hidden="true" />, onClick: () => void digitalProcessManager.openFolder(game, "download").catch(() => undefined) },
  ];
  return { artTitle, art, progress: percent, stats, actions };
}

/**
 * The running download and its install as the last groups of the game's log, each step once: the download's steps
 * (done with what they found and how long they took, the running one, failed), "Download finished", then the install's.
 * A step done is never listed again as one still to do.
 */
export function DownloadLog({ snapshot }: { snapshot: DownloadProgressSnapshot }) {
  const { t } = useI18n();
  const steps = downloadSteps(snapshot);
  const bars = downloadBars(snapshot);
  const install = installing(snapshot);
  const downloadDone = install || steps.find(step => step.id === "download")?.state === "done";
  const failed = steps.some(step => step.state === "failed");
  const line = (step: StepView) => <p key={step.id} className={`is-${step.state}`}>
    {t(STEP_TITLES[step.id])}{step.text ? ` · ${step.text}` : ""}{step.ms ? ` (${formatElapsed(step.ms)})` : ""}
  </p>;
  const of = (ids: string[], done: boolean) => steps.filter(step => ids.includes(step.id) && step.state !== "skipped" && (done ? step.state === "done" : true));
  return <>
    <div className={`lm-log-group is-${downloadDone ? "done" : failed ? "failed" : "working"}`}>
      <p className="lm-log-head">{t("logDownload")}{!downloadDone && transferStarted(snapshot) ? ` · ${Math.floor(bars.download)} %` : ""}</p>
      {of(DOWNLOAD_STEPS, Boolean(downloadDone)).map(line)}
      {downloadDone ? <p className="lm-log-foot">{t("logDownloadDone")}</p> : null}
    </div>
    {downloadDone ? <div className={`lm-log-group is-${failed ? "failed" : "working"}`}>
      <p className="lm-log-head">{t("logInstall")}{install ? ` · ${Math.floor(bars.install)} %` : ""}</p>
      {of(INSTALL_STEPS, false).map(line)}
    </div> : null}
  </>;
}
