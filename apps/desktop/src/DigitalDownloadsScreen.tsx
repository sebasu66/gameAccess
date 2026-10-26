import { useDeskSubtitle } from "./desk/DeskPanel";
import ManualDownloadForm from "./ManualDownloadForm";
import { useEffect, useRef, useState } from "react";
import { getAppLocale, translate, useI18n } from "./i18n";
import {formatDownloadBytes,sourceDownloadSize} from "./downloadSize";
import {downloadMethodLabel, planLabel} from "./downloadMethod";
import {downloadBars} from "./downloadBars";
export {formatDownloadBytes} from "./downloadSize";
import type { CatalogGame } from "./types";
import { ArrowDown, ArrowDownToLine, ArrowUp, CircleCheck, CircleX, Download, ExternalLink, FolderOpen, Pause, Play, Plus, RotateCcw, X } from "lucide-react";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { digitalDownloadService, type DigitalDownloadService } from "./catalog/DigitalDownloadService";
import type { DownloadPhase, DownloadProgressSnapshot } from "./downloadProvider";
import "./digital-downloads.css";
import DigitalDownloadArtwork, { DigitalDownloadThumb } from "./DigitalDownloadArtwork";
import DownloadTelemetry, { DownloadDial } from "./DownloadTelemetry";
import DownloadSteps from "./DownloadSteps";
import { transferStarted } from "./downloadStepModel";
import DownloadSpeedSpark from "./DownloadSpeedSpark";
import { useDialogFocus } from "./dialogFocus";
import { useOverlayClose } from "./useOverlayClose";
import { GaBack } from "./components/ga/Buttons";

const phaseKeys = {
  queued: "downloadQueued", preparing: "downloadPreparing", downloading: "downloadDownloading", paused: "downloadPaused",
  decompressing: "downloadDecompressing", installing: "downloadInstalling", cancelling: "downloadCancelling",
  cancelled: "downloadCancelled", interrupted: "downloadInterrupted", external: "downloadExternal", completed: "downloadCompleted", error: "downloadError",
} as const satisfies Record<DownloadPhase, Parameters<typeof translate>[0]>;
export function downloadPhaseLabel(phase: DownloadPhase, locale = getAppLocale()) {
  return translate(phaseKeys[phase], undefined, locale);
}
function eta(snapshot: DownloadProgressSnapshot): string {
  if (snapshot.phase !== "downloading" || !snapshot.speedBps || !snapshot.etaSeconds) return "—";
  const seconds = Math.ceil(snapshot.etaSeconds);
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.ceil((seconds % 3600) / 60)} min`
    : seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;
}
type Entry = ReturnType<DigitalDownloadService["getDownloads"]>[number];
const terminal = (entry: Entry) => ["completed", "error", "cancelled", "interrupted", "external"].includes(entry.snapshot.phase);
export default function DigitalDownloadsScreen({ onClose: onClosed, service = digitalDownloadService, onPlay, onOpenGame, catalogGames = [], embedded = false }: {
  /** Inside a desk panel (T10): the panel draws the header and handles focus and Esc. */
  embedded?: boolean;
  onClose: () => void; service?: DigitalDownloadService; onPlay?: (game: CatalogGame) => void | Promise<void>; catalogGames?: CatalogGame[]; onOpenGame?: (game: CatalogGame) => void;
}) {
  const {t,locale} = useI18n();
  const phaseLabel = (phase: DownloadPhase) => downloadPhaseLabel(phase,locale);
  const {closing,close:onClose}=useOverlayClose(onClosed);
  const dialogRef = useDialogFocus(onClose);
  useEffect(() => {
    if (embedded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [embedded]);
  const [entries, setEntries] = useState(() => service.getDownloads());
  const [busy, setBusy] = useState<number[]>([]);
  const [error, setError] = useState("");
  const pendingActions = useRef(new Set<number>());
  useEffect(() => {
    const refresh = () => setEntries(service.getDownloads());
    const unsubscribe = service.onGlobalUpdate(refresh);
    refresh();
    return unsubscribe;
  }, [service]);
  const active = entries.filter(entry => !terminal(entry) && !["queued", "paused"].includes(entry.snapshot.phase));
  const queue = entries.filter(entry => ["queued", "paused"].includes(entry.snapshot.phase));
  const history = entries.filter(terminal);
  const run = async (id: number, action: () => Promise<void>) => {
    if (pendingActions.current.has(id)) return;
    pendingActions.current.add(id);
    setBusy(current => [...current, id]); setError("");
    try { await action(); } catch (err) { setError(`${t("downloadsActionFailed")} ${err instanceof Error ? err.message : String(err)}`); }
    finally { pendingActions.current.delete(id); setBusy(current => current.filter(item => item !== id)); }
  };
  // The folder the download is in (the temporary one while downloading, the game's once unpacked). A download that
  // has not written anything yet (queued, measuring sources) has no folder, so no button.
  const hasFolder = ({ snapshot }: Entry) => transferStarted(snapshot) || Boolean(snapshot.resumeStep) || ["decompressing", "installing", "completed"].includes(snapshot.phase);
  const openFolder = (entry: Entry) => !hasFolder(entry) ? null : <button type="button" disabled={busy.includes(entry.snapshot.gameId)} aria-label={`${t("downloadsOpenFolder")}: ${entry.game.name}`} title={t("downloadsOpenFolder")} onClick={() => void run(entry.snapshot.gameId, async () => { await digitalProcessManager.openFolder(entry.game, "download"); })}><FolderOpen size={16} /></button>;
  const row = (entry: Entry, index: number, featured = false) => {
    const { game, snapshot } = entry;
    const currentGame = catalogGames.find(item => item.id === game.id || (game.app_id != null && item.app_id === game.app_id)) ?? game;
    const sourceSize = sourceDownloadSize(game,locale) || sourceDownloadSize(currentGame,locale) || t("downloadsSizeUnknown");
    const { phase, gameId } = snapshot;
    const bars = downloadBars(snapshot);
    const method = service.getDownloadMethod?.(gameId);
    const methodText = method ? downloadMethodLabel(method, locale) : null;
    const tier = service.planTier?.();
    const plan = tier ? planLabel(tier, locale) : null;
    const position = service.queuePosition?.(gameId) ?? -1;
    const queueLength = queue.filter(item => item.snapshot.phase === "queued").length;
    const transfer = phase === "downloading";
    const canPause = ["queued", "preparing", "downloading"].includes(phase);
    if (featured) {
      // An active download, top to bottom, with only what matters at this moment: the name and two small icons (the
      // plan: grey arrow BASE, gold arrow PLUS; "+" when the server accelerates it); a small wide picture with the speed
      // drawn over it while downloading; the progress of the stage running now (circle and bar, download or extract,
      // never both); the steps (while preparing: the running one and the next, expandable; afterwards only the ones
      // still to come); pause and cancel.
      const stage = phase === "downloading" || (phase === "paused" && transferStarted(snapshot)) ? "download" : ["decompressing", "installing"].includes(phase) ? "install" : null;
      const percent = stage === "download" ? bars.download : stage === "install" ? bars.install : 0;
      const art = <DigitalDownloadThumb game={currentGame} />;
      return <article className="ga-dl-card" key={gameId}>
        <header className="ga-dl-card-head">
          <h3 title={game.name}>{game.name}</h3>
          <span className="ga-dl-card-badges">
            {plan ? <span className={`ga-dl-badge plan-${tier}`} title={`${plan.label} · ${plan.hint}`} aria-label={`${plan.label}: ${plan.hint}`}><ArrowDownToLine size={14} aria-hidden="true" /></span> : null}
            {method === "accelerated" && methodText ? <span className="ga-dl-badge route-accelerated" title={methodText.hint} aria-label={`${methodText.label}: ${methodText.hint}`}><Plus size={13} strokeWidth={3} aria-hidden="true" /></span> : null}
          </span>
        </header>
        <div className="ga-dl-card-art">
          {onOpenGame ? <button type="button" aria-label={t("downloadsDetailsAria",{name:game.name})} onClick={() => onOpenGame(currentGame)}>{art}</button> : art}
          {phase === "downloading" ? <DownloadSpeedSpark samples={service.getSpeedSamples(gameId)} speedBps={snapshot.speedBps} /> : null}
        </div>
        {/* The panel's own components (the telemetry dial and the progress line with its bar), as they were. */}
        {stage ? <div className="ga-download-telemetry ga-dl-card-progress">
          <DownloadDial percent={percent} label={stage === "download" ? t("downloadsDownloadBar") : t("downloadsInstallBar")} />
          <div className="ga-dl-card-bar">
            <div className="digital-download-progress-line"><span>{stage === "download" ? t("downloadsDownloadBar") : t("downloadsInstallBar")}</span><strong>{Math.round(percent)}%</strong></div>
            <progress className="download-phase-progress" max={100} value={percent} aria-label={t("downloadsProgress",{name:game.name,status:stage === "download" ? t("downloadsDownloadBar") : t("downloadsInstallBar")})} />
            {stage === "download" ? <p className="ga-dl-card-eta">{t("downloadsRemaining")}: <strong>{eta(snapshot)}</strong></p> : null}
          </div>
        </div> : null}
        <DownloadSteps snapshot={snapshot} />
        <div className="ga-dl-card-actions">
          {canPause ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.pause(gameId))}><Pause size={16} /><span className="ga-dl-label">{t("downloadsPause")}</span></button> : null}
          {phase === "paused" ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.resume(gameId))}><Play size={16} /><span className="ga-dl-label">{t("downloadsResume")}</span></button> : null}
          <button disabled={busy.includes(gameId) || phase === "cancelling"} aria-label={t("downloadsCancelAria",{name:game.name})} onClick={() => void run(gameId, () => service.cancel(gameId))}><X size={16} /><span className="ga-dl-label">{t("downloadsCancel")}</span></button>
          {openFolder(entry)}
        </div>
      </article>;
    }
    return <article className={`digital-download-row ${featured ? "digital-download-featured" : ""}`} key={gameId}>
      {onOpenGame ? <button type="button" className="digital-download-art" aria-label={t("downloadsDetailsAria",{name:game.name})} onClick={() => onOpenGame(currentGame)}><DigitalDownloadArtwork game={currentGame} /></button> : <div className="digital-download-art"><DigitalDownloadArtwork game={currentGame} /></div>}
      <div className="digital-download-info">
        <div className="digital-download-title"><h2>{game.name}</h2>{methodText && !["cancelled","error"].includes(phase) ? <span className={`ga-method-pill method-${method}`} title={methodText.hint}>{methodText.label}</span> : null}{plan && !terminal(entry) ? <span className={`ga-plan-pill plan-${tier}`} title={plan.hint}>{plan.label}</span> : null}{phase === "completed" || phase === "error" ? <span className={`digital-download-state state-${phase} is-icon`} role="img" aria-label={phaseLabel(phase)} title={phaseLabel(phase)}>{phase === "completed" ? <CircleCheck size={22} aria-hidden="true" /> : <CircleX size={22} aria-hidden="true" />}</span> : <span className={`digital-download-state state-${phase}`}>{phase === "queued" ? `${(position >= 0 ? position : index) + 1} · ${phaseLabel(phase)}` : phaseLabel(phase)}</span>}</div>
        <p>{snapshot.statusText || snapshot.error || phaseLabel(phase)}</p>
        <p className="ga-download-source-size">{t("downloadsSize")}: <strong>{sourceSize}</strong></p>
        {["downloading", "paused"].includes(phase) ? <DownloadTelemetry snapshot={snapshot} samples={service.getSpeedSamples(gameId)} /> : null}
        {/* Bars, speed and time left only once the transfer has begun; before, the steps say what is happening. */}
        {transferStarted(snapshot) ? <>
          <div className="digital-download-progress-line"><span>{t("downloadsDownloadBar")}</span><strong>{Math.round(bars.download)}%</strong></div>
          <progress className="download-phase-progress" max={100} value={bars.download} aria-label={t("downloadsProgress",{name:game.name,status:t("downloadsDownloadBar")})} />
          <div className="digital-download-progress-line digital-download-install-line"><span>{phase === "completed" ? t("downloadsInstalled") : t("downloadsInstallBar")}</span><strong>{Math.round(bars.install)}%</strong></div>
          <progress className="download-phase-progress download-install-progress" max={100} value={bars.install} aria-label={t("downloadsProgress",{name:game.name,status:t("downloadsInstallBar")})} />
          <dl className="digital-download-metrics">
            <div><dt>{t("downloadsDownloaded")}</dt><dd>{formatDownloadBytes(snapshot.bytesDownloaded,locale)} / {sourceSize}</dd></div>
            <div><dt>{t("downloadsSpeed")}</dt><dd>{transfer ? `${formatDownloadBytes(snapshot.speedBps,locale)} / s` : "—"}</dd></div>
            <div><dt>{t("downloadsRemaining")}</dt><dd>{eta(snapshot)}</dd></div>
          </dl>
        </> : null}
      </div>
      <div className="digital-download-actions">
        <button type="button" className="digital-download-dismiss" disabled={busy.includes(gameId) || phase === "cancelling"} aria-label={t(terminal(entry) ? "downloadsRemoveAria" : "downloadsCancelAria", {name:game.name})} title={t(terminal(entry) ? "downloadsRemove" : "downloadsCancel")} onClick={() => void run(gameId, () => service.remove(gameId))}><X size={18} /></button>
        {phase === "external" ? <button type="button" disabled={busy.includes(gameId)} aria-label={t("downloadsOpenExternalLink")} onClick={() => void run(gameId, () => service.start(game))}><ExternalLink size={16} /><span className="ga-dl-label">{busy.includes(gameId) ? t("downloadsLaunching") : t("downloadsOpenExternalLink")}</span></button> : null}
        {phase === "completed" ? <button type="button" className="ga-download-play" disabled={busy.includes(gameId)} aria-label={t("downloadsPlayAria",{name:game.name})} onClick={() => void run(gameId, async () => { if(onPlay) await onPlay(game); else await service.play(game); })}><Play size={20} fill="currentColor"/><span className="ga-dl-label">{busy.includes(gameId) ? t("downloadsLaunching") : t("downloadsPlay")}</span></button> : null}
        {phase === "queued" && position > 0 ? <button disabled={busy.includes(gameId)} aria-label={t("downloadsMoveUpAria",{name:game.name})} title={t("downloadsMoveUp")} onClick={() => service.moveInQueue(gameId, -1)}><ArrowUp size={16} /><span className="ga-dl-label">{t("downloadsMoveUp")}</span></button> : null}
        {phase === "queued" && position >= 0 && position < queueLength - 1 ? <button disabled={busy.includes(gameId)} aria-label={t("downloadsMoveDownAria",{name:game.name})} title={t("downloadsMoveDown")} onClick={() => service.moveInQueue(gameId, 1)}><ArrowDown size={16} /><span className="ga-dl-label">{t("downloadsMoveDown")}</span></button> : null}
        {canPause ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.pause(gameId))}><Pause size={16} /><span className="ga-dl-label">{t("downloadsPause")}</span></button> : null}
        {phase === "paused" ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.resume(gameId))}><Play size={16} /><span className="ga-dl-label">{t("downloadsResume")}</span></button> : null}
        {/* A stopped download goes on from the step it reached (unpacking again, or the rest of the download). */}
        {["error", "interrupted"].includes(phase) ? <button className="ga-download-resume" disabled={busy.includes(gameId)} title={snapshot.resumeStep === "extract" ? t("downloadsResumeExtractHint") : snapshot.resumeStep === "download" ? t("downloadsResumeDownloadHint") : undefined} onClick={() => void run(gameId, () => service.retry(game))}>{snapshot.resumeStep ? <Play size={16} /> : <RotateCcw size={16} />}<span className="ga-dl-label">{snapshot.resumeStep === "extract" ? t("downloadsResumeExtract") : snapshot.resumeStep === "download" ? t("downloadsResumeDownload") : t("downloadsRetry")}</span></button> : null}
        {phase === "cancelled" ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.start(game))}><RotateCcw size={16} /><span className="ga-dl-label">{t("downloadsRetry")}</span></button> : null}
        {["error", "interrupted"].includes(phase) ? <button disabled={busy.includes(gameId)} aria-label={t("downloadsAbortAria",{name:game.name})} onClick={() => void run(gameId, () => service.cancel(gameId))}><X size={16} /><span className="ga-dl-label">{t("downloadsAbort")}</span></button> : null}
        {!terminal(entry) ? <button disabled={busy.includes(gameId) || phase === "cancelling"} aria-label={t("downloadsCancelAria",{name:game.name})} onClick={() => void run(gameId, () => service.cancel(gameId))}><X size={16} /><span className="ga-dl-label">{t("downloadsCancel")}</span></button> : null}
        {!["cancelled", "cancelling", "external"].includes(phase) ? openFolder(entry) : null}
      </div>
    </article>;
  };
  const summary = t("downloadsSummary",{pending:entries.filter(entry => !terminal(entry)).length,completed:history.filter(entry => entry.snapshot.phase === "completed").length});
  useDeskSubtitle(embedded ? summary : "");
  return <section ref={embedded ? undefined : dialogRef} className={`digital-downloads-screen${embedded ? " is-embedded" : ""}${closing ? " is-closing" : ""}`} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-label={t("downloadsManager")}>
    {embedded ? null : <header className="digital-downloads-heading">
      <div><span className="digital-download-eyebrow">DIGITAL</span><h1>{t("downloadsTitle")}</h1><p>{summary}</p></div>
      <GaBack className="digital-download-back" label={t("back")} data-dialog-initial onClick={onClose} aria-label={t("downloadsCloseAria")} />
    </header>}
    {error ? <p role="alert" className="digital-download-error">{error}</p> : null}
    {!entries.length ? <div className="digital-download-empty"><Download size={42} /><h2>{t("downloadsEmpty")}</h2><p>{t("downloadsEmptyHelp")}</p><button onClick={onClose}>{t("downloadsBrowse")}</button></div> : null}
    {active.length ? <section aria-label={t("downloadsActive")}><h2 className="digital-download-section-label">{t("downloadsInProgress")}</h2>{active.map((entry, index) => row(entry, index, true))}</section> : null}
    {queue.length ? <section aria-label={t("downloadsQueue")}><h2 className="digital-download-section-label">{t("downloadsQueueHeading",{count:queue.length})}</h2>{queue.map((entry, index) => row(entry, index))}</section> : null}
    {history.length ? <section aria-label={t("downloadsHistory")}><h2 className="digital-download-section-label">{t("downloadsSession")}</h2>{history.map((entry, index) => row(entry, index))}</section> : null}
    <details className="manual-download-entry"><summary>{locale === "es" ? "Añadir descarga manual" : "Add manual download"}</summary><ManualDownloadForm /></details>
  </section>;
}
