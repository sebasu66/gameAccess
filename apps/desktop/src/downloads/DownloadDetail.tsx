import { useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowUp, FolderOpen, Pause, Play, Plus, RotateCcw, X } from "lucide-react";
import { digitalProcessManager } from "../catalog/DigitalProcessManager";
import type { DigitalDownloadService } from "../catalog/DigitalDownloadService";
import { DigitalDownloadThumb } from "../DigitalDownloadArtwork";
import { downloadPhaseLabel, eta } from "../DigitalDownloadsScreen";
import { downloadBars } from "../downloadBars";
import { downloadMethodLabel, planLabel } from "../downloadMethod";
import type { DownloadProgressSnapshot } from "../downloadProvider";
import { formatDownloadBytes, sourceDownloadSize } from "../downloadSize";
import DownloadSpeedSpark from "../DownloadSpeedSpark";
import DownloadSteps from "../DownloadSteps";
import { transferStarted } from "../downloadStepModel";
import { DownloadDial } from "../DownloadTelemetry";
import { useI18n } from "../i18n";
import { confirmNotice } from "../notice/notice";
import { noticeGame } from "../notice/noticeGame";
import { notify } from "../toasts";
import type { CatalogGame } from "../types";
import "../digital-downloads.css";

export type DownloadEntry = { game: CatalogGame; snapshot: DownloadProgressSnapshot };

/**
 * A download's detail (docs/GUI_DESIGN.md §4.21): in its game's row of the Library Manager, where the game's whole
 * install lives (Seba, 2026-11-01). The name and the plan's icons, a wide picture with the speed drawn over it, the
 * running stage's dial and bar, the steps with the sizes, and its actions: pause or resume, up and down in the queue,
 * go on after a stop, cancel (asked in the notice) and the download's folder.
 */
export default function DownloadDetail({ entry, service, queueLength = 0 }: { entry: DownloadEntry; service: DigitalDownloadService; queueLength?: number }) {
  const { t, locale } = useI18n();
  const { game, snapshot } = entry;
  const { phase, gameId } = snapshot;
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (error) { notify(`${t("downloadsActionFailed")} ${error instanceof Error ? error.message : String(error)}`, { tone: "error" }); }
    finally { setBusy(false); }
  };
  const cancel = () => void confirmNotice({ game: noticeGame(game), title: t("cancelDownloadTitle", { name: game.name }), text: t("cancelDownloadBody"), confirmLabel: t("downloadsCancel"), cancelLabel: t("keepDownloading") })
    .then(ok => { if (ok) void run(() => service.cancel(gameId)); });

  const bars = downloadBars(snapshot);
  const method = service.getDownloadMethod?.(gameId);
  const methodText = method ? downloadMethodLabel(method, locale) : null;
  const tier = service.planTier?.();
  const plan = tier ? planLabel(tier, locale) : null;
  const position = service.queuePosition?.(gameId) ?? -1;
  const totalSize = (snapshot.bytesTotal ?? 0) > 0 ? formatDownloadBytes(snapshot.bytesTotal, locale) : sourceDownloadSize(game, locale) || t("downloadsSizeUnknown");
  const stopped = phase === "error" || phase === "interrupted";
  const canPause = ["queued", "preparing", "downloading"].includes(phase);
  const hasFolder = transferStarted(snapshot) || Boolean(snapshot.resumeStep) || ["decompressing", "installing"].includes(phase);
  // A resumed download first checks what is already on disk (minutes for a big torrent): that is a stage of its own.
  const stage = phase === "downloading" || (phase === "paused" && transferStarted(snapshot)) ? "download" : ["decompressing", "installing"].includes(phase) ? "install" : typeof snapshot.checkPercent === "number" ? "check" : null;
  const percent = stage === "download" ? bars.download : stage === "install" ? bars.install : stage === "check" ? snapshot.checkPercent ?? 0 : 0;
  const stageLabel = stage === "download" ? t("downloadsDownloadBar") : stage === "install" ? t("downloadsInstallBar") : t("downloadsCheckBar");

  return <article className="ga-dl-card lm-download" data-phase={phase}>
    <header className="ga-dl-card-head">
      <h3 title={game.name}>{phase === "queued" && position >= 0 ? `${position + 1} · ` : ""}{downloadPhaseLabel(phase, locale)}</h3>
      <span className="ga-dl-card-badges">
        {plan ? <span className={`ga-dl-badge plan-${tier}`} title={`${plan.label} · ${plan.hint}`} aria-label={`${plan.label}: ${plan.hint}`}><ArrowDownToLine size={14} aria-hidden="true" /></span> : null}
        {method === "accelerated" && methodText ? <span className="ga-dl-badge route-accelerated" title={methodText.hint} aria-label={`${methodText.label}: ${methodText.hint}`}><Plus size={13} strokeWidth={3} aria-hidden="true" /></span> : null}
      </span>
    </header>
    <div className="ga-dl-card-art">
      <DigitalDownloadThumb game={game} />
      {phase === "downloading" ? <DownloadSpeedSpark samples={service.getSpeedSamples(gameId)} speedBps={snapshot.speedBps} /> : null}
    </div>
    {stage ? <div className="ga-download-telemetry ga-dl-card-progress">
      <DownloadDial percent={percent} label={stageLabel} />
      <div className="ga-dl-card-bar">
        <div className="digital-download-progress-line"><span>{stageLabel}</span><strong>{Math.round(percent)}%</strong></div>
        <progress className="download-phase-progress" max={100} value={percent} aria-label={t("downloadsProgress", { name: game.name, status: stageLabel })} />
        {stage === "download" ? <p className="ga-dl-card-eta">{t("downloadsRemaining")}: <strong>{eta(snapshot)}</strong></p> : null}
        {stage === "check" ? <p className="ga-dl-card-eta">{t("downloadsCheckHint")}</p> : null}
      </div>
    </div> : null}
    {stopped ? <p className="lm-download-error">{snapshot.statusText || snapshot.error || downloadPhaseLabel(phase, locale)}</p> : null}
    <DownloadSteps snapshot={snapshot} phaseLabel={downloadPhaseLabel(phase, locale)} details={
      <dl className="digital-download-metrics ga-dl-card-details">
        <div><dt>{t("downloadsSize")}</dt><dd>{totalSize}</dd></div>
        {transferStarted(snapshot) || (snapshot.bytesDownloaded ?? 0) > 0 ? <div><dt>{t("downloadsDownloaded")}</dt><dd>{formatDownloadBytes(snapshot.bytesDownloaded, locale)} / {totalSize}</dd></div> : null}
        {phase === "downloading" ? <div><dt>{t("downloadsSpeed")}</dt><dd>{`${formatDownloadBytes(snapshot.speedBps, locale)} / s`}</dd></div> : null}
        {methodText ? <div><dt>{t("downloadsRouteLabel")}</dt><dd title={methodText.hint}>{methodText.label}</dd></div> : null}
        {plan ? <div><dt>{t("downloadsPlanLabel")}</dt><dd title={plan.hint}>{plan.label}</dd></div> : null}
      </dl>} />
    <div className="ga-dl-card-actions lm-download-actions">
      {phase === "queued" && position > 0 ? <button type="button" disabled={busy} aria-label={t("downloadsMoveUpAria", { name: game.name })} onClick={() => service.moveInQueue(gameId, -1)}><ArrowUp size={16} /><span className="ga-dl-label">{t("downloadsMoveUp")}</span></button> : null}
      {phase === "queued" && position >= 0 && position < queueLength - 1 ? <button type="button" disabled={busy} aria-label={t("downloadsMoveDownAria", { name: game.name })} onClick={() => service.moveInQueue(gameId, 1)}><ArrowDown size={16} /><span className="ga-dl-label">{t("downloadsMoveDown")}</span></button> : null}
      {canPause ? <button type="button" disabled={busy} onClick={() => void run(() => service.pause(gameId))}><Pause size={16} /><span className="ga-dl-label">{t("downloadsPause")}</span></button> : null}
      {phase === "paused" ? <button type="button" disabled={busy} onClick={() => void run(() => service.resume(gameId))}><Play size={16} /><span className="ga-dl-label">{t("downloadsResume")}</span></button> : null}
      {/* A stopped download goes on from the step it reached (unpacking again, or the rest of the download). */}
      {stopped ? <button type="button" className="ga-download-resume" disabled={busy} onClick={() => void run(() => service.retry(game))}>{snapshot.resumeStep ? <Play size={16} /> : <RotateCcw size={16} />}<span className="ga-dl-label">{snapshot.resumeStep === "extract" ? t("downloadsResumeExtract") : snapshot.resumeStep === "download" ? t("downloadsResumeDownload") : t("downloadsRetry")}</span></button> : null}
      <button type="button" disabled={busy || phase === "cancelling"} aria-label={t("downloadsCancelAria", { name: game.name })} onClick={cancel}><X size={16} /><span className="ga-dl-label">{stopped ? t("downloadsAbort") : t("downloadsCancel")}</span></button>
      {hasFolder ? <button type="button" disabled={busy} aria-label={`${t("downloadsOpenFolder")}: ${game.name}`} onClick={() => void run(async () => { await digitalProcessManager.openFolder(game, "download"); })}><FolderOpen size={16} /><span className="ga-dl-label">{t("downloadsOpenFolder")}</span></button> : null}
    </div>
  </article>;
}
