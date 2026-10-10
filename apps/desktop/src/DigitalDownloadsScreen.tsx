import { useEffect, useRef, useState } from "react";
import { getAppLocale, translate, useI18n } from "./i18n";
import {formatDownloadBytes,sourceDownloadSize} from "./downloadSize";
export {formatDownloadBytes} from "./downloadSize";
import type { CatalogGame } from "./types";
import { Download, ExternalLink, Pause, Play, RotateCcw, X } from "lucide-react";
import { digitalDownloadService, type DigitalDownloadService } from "./catalog/DigitalDownloadService";
import type { DownloadPhase, DownloadProgressSnapshot } from "./downloadProvider";
import "./digital-downloads.css";
import DigitalDownloadArtwork from "./DigitalDownloadArtwork";
import DownloadTelemetry from "./DownloadTelemetry";
import { useDialogFocus } from "./dialogFocus";
import { useOverlayClose } from "./useOverlayClose";

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
export default function DigitalDownloadsScreen({ onClose: onClosed, service = digitalDownloadService, onPlay, onOpenGame, catalogGames = [] }: {
  onClose: () => void; service?: DigitalDownloadService; onPlay?: (game: CatalogGame) => void | Promise<void>; catalogGames?: CatalogGame[]; onOpenGame?: (game: CatalogGame) => void;
}) {
  const {t,locale} = useI18n();
  const phaseLabel = (phase: DownloadPhase) => downloadPhaseLabel(phase,locale);
  const {closing,close:onClose}=useOverlayClose(onClosed);
  const dialogRef = useDialogFocus(onClose);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
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
  const row = (entry: Entry, index: number, featured = false) => {
    const { game, snapshot } = entry;
    const currentGame = catalogGames.find(item => item.id === game.id || (game.app_id != null && item.app_id === game.app_id)) ?? game;
    const sourceSize = sourceDownloadSize(game,locale) || sourceDownloadSize(currentGame,locale) || t("downloadsSizeUnknown");
    const { phase, gameId } = snapshot;
    const percent = Number.isFinite(snapshot.progress) ? Math.max(0, Math.min(100, snapshot.progress)) : 0;
    const transfer = phase === "downloading";
    const canPause = ["queued", "preparing", "downloading"].includes(phase);
    return <article className={`digital-download-row ${featured ? "digital-download-featured" : ""}`} key={gameId}>
      {onOpenGame ? <button type="button" className="digital-download-art" aria-label={t("downloadsDetailsAria",{name:game.name})} onClick={() => onOpenGame(currentGame)}><DigitalDownloadArtwork game={currentGame} /></button> : <div className="digital-download-art"><DigitalDownloadArtwork game={currentGame} /></div>}
      <div className="digital-download-info">
        <div className="digital-download-title"><h2>{game.name}</h2><span className={`digital-download-state state-${phase}`}>{phase === "queued" ? `${index + 1} · ${phaseLabel(phase)}` : phaseLabel(phase)}</span></div>
        <p>{snapshot.statusText || snapshot.error || phaseLabel(phase)}</p>
        <p className="ga-download-source-size">{t("downloadsSize")}: <strong>{sourceSize}</strong></p>
        {["downloading", "paused"].includes(phase) ? <DownloadTelemetry snapshot={snapshot} samples={service.getSpeedSamples(gameId)} /> : null}
        {phase !== "queued" && phase !== "cancelled" && phase !== "error" && phase !== "external" ? <>
          <div className="digital-download-progress-line"><span>{phase === "completed" ? t("downloadsInstalled") : phaseLabel(phase)}</span><strong>{Math.round(percent)}%</strong></div>
          <progress className="download-phase-progress" max={100} value={percent} aria-label={t("downloadsProgress",{name:game.name,status:phaseLabel(phase)})} />
          <dl className="digital-download-metrics">
            <div><dt>{t("downloadsDownloaded")}</dt><dd>{formatDownloadBytes(snapshot.bytesDownloaded,locale)} / {sourceSize}</dd></div>
            <div><dt>{t("downloadsSpeed")}</dt><dd>{transfer ? `${formatDownloadBytes(snapshot.speedBps,locale)} / s` : "—"}</dd></div>
            <div><dt>{t("downloadsRemaining")}</dt><dd>{eta(snapshot)}</dd></div>
          </dl>
        </> : null}
      </div>
      <div className="digital-download-actions">
        <button type="button" className="digital-download-dismiss" disabled={busy.includes(gameId) || phase === "cancelling"} aria-label={t(terminal(entry) ? "downloadsRemoveAria" : "downloadsCancelAria", {name:game.name})} title={t(terminal(entry) ? "downloadsRemove" : "downloadsCancel")} onClick={() => void run(gameId, () => service.remove(gameId))}><X size={18} /></button>
        {phase === "external" ? <button type="button" disabled={busy.includes(gameId)} aria-label={t("downloadsOpenExternalLink")} onClick={() => void run(gameId, () => service.start(game))}><ExternalLink size={16} />{busy.includes(gameId) ? t("downloadsLaunching") : t("downloadsOpenExternalLink")}</button> : null}
        {phase === "completed" ? <button type="button" className="ga-download-play" disabled={busy.includes(gameId)} aria-label={t("downloadsPlayAria",{name:game.name})} onClick={() => void run(gameId, async () => { if(onPlay) await onPlay(game); else await service.play(game); })}><Play size={20} fill="currentColor"/>{busy.includes(gameId) ? t("downloadsLaunching") : t("downloadsPlay")}</button> : null}
        {canPause ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.pause(gameId))}><Pause size={16} />{t("downloadsPause")}</button> : null}
        {phase === "paused" ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.resume(gameId))}><Play size={16} />{t("downloadsResume")}</button> : null}
        {["error", "interrupted", "cancelled"].includes(phase) ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.start(game))}><RotateCcw size={16} />{t("downloadsRetry")}</button> : null}
        {["error", "interrupted"].includes(phase) ? <button disabled={busy.includes(gameId)} aria-label={t("downloadsAbortAria",{name:game.name})} onClick={() => void run(gameId, () => service.cancel(gameId))}><X size={16} />{t("downloadsAbort")}</button> : null}
        {!terminal(entry) ? <button disabled={busy.includes(gameId) || phase === "cancelling"} aria-label={t("downloadsCancelAria",{name:game.name})} onClick={() => void run(gameId, () => service.cancel(gameId))}><X size={16} />{t("downloadsCancel")}</button> : null}
      </div>
    </article>;
  };
  return <section ref={dialogRef} className={`digital-downloads-screen${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={t("downloadsManager")}>
    <header className="digital-downloads-heading">
      <div><span className="digital-download-eyebrow">DIGITAL</span><h1>{t("downloadsTitle")}</h1><p>{t("downloadsSummary",{pending:entries.filter(entry => !terminal(entry)).length,completed:history.filter(entry => entry.snapshot.phase === "completed").length})}</p></div>
      <button type="button" className="digital-download-back" data-dialog-initial onClick={onClose} aria-label={t("downloadsCloseAria")}><X size={18} />{t("close")}</button>
    </header>
    {error ? <p role="alert" className="digital-download-error">{error}</p> : null}
    {!entries.length ? <div className="digital-download-empty"><Download size={42} /><h2>{t("downloadsEmpty")}</h2><p>{t("downloadsEmptyHelp")}</p><button onClick={onClose}>{t("downloadsBrowse")}</button></div> : null}
    {active.length ? <section aria-label={t("downloadsActive")}><h2 className="digital-download-section-label">{t("downloadsInProgress")}</h2>{active.map((entry, index) => row(entry, index, true))}</section> : null}
    {queue.length ? <section aria-label={t("downloadsQueue")}><h2 className="digital-download-section-label">{t("downloadsQueueHeading",{count:queue.length})}</h2>{queue.map((entry, index) => row(entry, index))}</section> : null}
    {history.length ? <section aria-label={t("downloadsHistory")}><h2 className="digital-download-section-label">{t("downloadsSession")}</h2>{history.map((entry, index) => row(entry, index))}</section> : null}
  </section>;
}
