import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { downloadPhaseLabels, formatDownloadBytes } from "./DigitalDownloadsScreen";
import "./digital-download-toast.css";
import DigitalDownloadArtwork from "./DigitalDownloadArtwork";

const terminal = new Set(["completed", "cancelled", "error", "interrupted"]);
type Entry = ReturnType<typeof digitalDownloadService.getDownloads>[number];

export default function DigitalDownloadToast({ onOpen }: { onOpen: () => void }) {
  const [entries, setEntries] = useState(() => digitalDownloadService.getDownloads());
  const [notice, setNotice] = useState<Entry | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = digitalDownloadService.onGlobalUpdate(snapshot => {
      const current = digitalDownloadService.getDownloads();
      setEntries(current);
      if (terminal.has(snapshot.phase)) {
        setNotice(current.find(entry => entry.snapshot.gameId === snapshot.gameId) ?? null);
        clearTimeout(timer);
        timer = setTimeout(() => setNotice(null), 8000);
      }
    });
    setEntries(digitalDownloadService.getDownloads());
    return () => { unsubscribe(); clearTimeout(timer); };
  }, []);
  const pending = entries.filter(entry => !terminal.has(entry.snapshot.phase));
  const entry = pending.find(item => !["queued", "paused"].includes(item.snapshot.phase)) ?? pending[0] ?? notice;
  if (!entry) return null;
  const { game, snapshot } = entry;
  const percent = Number.isFinite(snapshot.progress) ? Math.max(0, Math.min(100, snapshot.progress)) : 0;
  const status = downloadPhaseLabels[snapshot.phase];
  return <button type="button" className="digital-download-toast" onClick={onOpen} aria-label={`Abrir gestor de descargas · ${game.name} · ${status}`}>
    <span className="digital-download-toast-art"><DigitalDownloadArtwork game={game} /></span>
    <span className="digital-download-toast-content">
      <span className="digital-download-toast-heading"><span>DESCARGAS · DIGITAL</span><ChevronRight size={16} /></span>
      <strong>{game.name}</strong>
      <span className="digital-download-toast-status">{status}{snapshot.phase === "downloading" ? ` · ${Math.round(percent)}% · ${formatDownloadBytes(snapshot.speedBps)} / s` : ""}{pending.length > 1 ? ` · ${pending.length - 1} más pendientes` : ""}</span>
      {snapshot.phase !== "queued" && !terminal.has(snapshot.phase) ? <progress value={percent} max={100} aria-label={`Progreso de ${game.name}`} /> : null}
      <span className="digital-download-toast-link">Abrir gestor de descargas</span>
    </span>
  </button>;
}
