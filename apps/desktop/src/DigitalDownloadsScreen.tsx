import { useEffect, useState } from "react";
import { ArrowLeft, Download, Pause, Play, RotateCcw, X } from "lucide-react";
import { digitalDownloadService, type DigitalDownloadService } from "./catalog/DigitalDownloadService";
import type { DownloadPhase, DownloadProgressSnapshot } from "./downloadProvider";
import "./digital-downloads.css";

export const downloadPhaseLabels: Record<DownloadPhase, string> = {
  queued: "En cola", preparing: "Preparando", downloading: "Descargando", paused: "Pausada",
  decompressing: "Descomprimiendo", installing: "Instalando", cancelling: "Cancelando",
  cancelled: "Cancelada", interrupted: "Interrumpida", completed: "Listo para jugar", error: "Error",
};
export function formatDownloadBytes(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.max(value, 0), index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
  return `${size.toLocaleString("es-AR", { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}
function eta(snapshot: DownloadProgressSnapshot): string {
  if (snapshot.phase !== "downloading" || !snapshot.speedBps || !snapshot.etaSeconds) return "—";
  const seconds = Math.ceil(snapshot.etaSeconds);
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.ceil((seconds % 3600) / 60)} min`
    : seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;
}
type Entry = ReturnType<DigitalDownloadService["getDownloads"]>[number];
const terminal = (entry: Entry) => ["completed", "error", "cancelled", "interrupted"].includes(entry.snapshot.phase);
export default function DigitalDownloadsScreen({ onClose, service = digitalDownloadService }: {
  onClose: () => void; service?: DigitalDownloadService;
}) {
  const [entries, setEntries] = useState(() => service.getDownloads());
  const [busy, setBusy] = useState<number[]>([]);
  const [error, setError] = useState("");
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
    if (busy.includes(id)) return;
    setBusy(current => [...current, id]); setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(current => current.filter(item => item !== id)); }
  };
  const row = (entry: Entry, index: number, featured = false) => {
    const { game, snapshot } = entry;
    const { phase, gameId } = snapshot;
    const percent = Number.isFinite(snapshot.progress) ? Math.max(0, Math.min(100, snapshot.progress)) : 0;
    const transfer = phase === "downloading";
    const canPause = ["queued", "preparing", "downloading"].includes(phase);
    return <article className={`digital-download-row ${featured ? "digital-download-featured" : ""}`} key={gameId}>
      <div className="digital-download-art">{game.header_image ? <img src={game.header_image} alt="" /> : <Download size={32} />}</div>
      <div className="digital-download-info">
        <div className="digital-download-title"><h2>{game.name}</h2><span className={`digital-download-state state-${phase}`}>{phase === "queued" ? `${index + 1} · En cola` : downloadPhaseLabels[phase]}</span></div>
        <p>{snapshot.error || snapshot.statusText || downloadPhaseLabels[phase]}</p>
        {phase !== "queued" && phase !== "cancelled" && phase !== "error" ? <>
          <div className="digital-download-progress-line"><span>{phase === "completed" ? "Instalación completada" : downloadPhaseLabels[phase]}</span><strong>{Math.round(percent)}%</strong></div>
          <progress max={100} value={percent} aria-label={`Progreso de ${game.name} · ${downloadPhaseLabels[phase]}`} />
          <dl className="digital-download-metrics">
            <div><dt>Descargado</dt><dd>{formatDownloadBytes(snapshot.bytesDownloaded)} / {snapshot.bytesTotal ? formatDownloadBytes(snapshot.bytesTotal) : "—"}</dd></div>
            <div><dt>Velocidad</dt><dd>{transfer ? `${formatDownloadBytes(snapshot.speedBps)} / s` : "—"}</dd></div>
            <div><dt>Tiempo restante</dt><dd>{eta(snapshot)}</dd></div>
          </dl>
        </> : null}
      </div>
      <div className="digital-download-actions">
        {canPause ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.pause(gameId))}><Pause size={16} />Pausar</button> : null}
        {phase === "paused" ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.resume(gameId))}><Play size={16} />Reanudar</button> : null}
        {["error", "interrupted", "cancelled"].includes(phase) ? <button disabled={busy.includes(gameId)} onClick={() => void run(gameId, () => service.start(game))}><RotateCcw size={16} />Reintentar</button> : null}
        {!terminal(entry) ? <button disabled={busy.includes(gameId) || phase === "cancelling"} aria-label={`Cancelar descarga de ${game.name}`} onClick={() => void run(gameId, () => service.cancel(gameId))}><X size={16} />Cancelar</button> : null}
      </div>
    </article>;
  };
  return <section className="digital-downloads-screen" aria-label="Gestor de descargas Digital">
    <header className="digital-downloads-heading">
      <button className="digital-download-back" onClick={onClose}><ArrowLeft size={18} />Volver al catálogo</button>
      <div><span className="digital-download-eyebrow">DIGITAL</span><h1>Descargas</h1><p>{entries.filter(entry => !terminal(entry)).length} pendientes · {history.filter(entry => entry.snapshot.phase === "completed").length} completadas</p></div>
    </header>
    {error ? <p role="alert" className="digital-download-error">{error}</p> : null}
    {!entries.length ? <div className="digital-download-empty"><Download size={42} /><h2>No hay descargas</h2><p>Elegí un juego del catálogo Digital para comenzar.</p><button onClick={onClose}>Explorar catálogo</button></div> : null}
    {active.length ? <section aria-label="Descarga activa"><h2 className="digital-download-section-label">EN CURSO</h2>{active.map((entry, index) => row(entry, index, true))}</section> : null}
    {queue.length ? <section aria-label="Cola de descargas"><h2 className="digital-download-section-label">COLA DE DESCARGAS · {queue.length}</h2>{queue.map((entry, index) => row(entry, index))}</section> : null}
    {history.length ? <section aria-label="Historial de descargas"><h2 className="digital-download-section-label">FINALIZADAS</h2>{history.map((entry, index) => row(entry, index))}</section> : null}
  </section>;
}

