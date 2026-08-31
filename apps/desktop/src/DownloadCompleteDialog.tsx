import { Check, Play, X } from "lucide-react";

import type { CatalogGame } from "./types";

interface DownloadCompleteDialogProps {
  game: CatalogGame;
  busy: boolean;
  onPlay: () => void;
  onClose: () => void;
}

export default function DownloadCompleteDialog({ game, busy, onPlay, onClose }: DownloadCompleteDialogProps) {
  const canPlay = game.copies_available > 0 && !busy;
  return (
    <div className="download-complete-backdrop" role="presentation">
      <section className="download-complete-dialog" role="dialog" aria-modal="true" aria-label={`Descarga completa: ${game.name}`}>
        <button type="button" className="download-dialog-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <span className="download-complete-icon"><Check size={26} /></span>
        <span className="eyebrow">DESCARGA TERMINADA</span>
        <h2>{game.name} ya está listo para jugar</h2>
        <p>Steam confirmó que la instalación está completa. ¿Querés jugar ahora?</p>
        <div className="download-complete-actions">
          <button type="button" className="primary-button" disabled={!canPlay} onClick={onPlay}><Play size={18} fill="currentColor" /> Jugar ahora</button>
          <button type="button" className="secondary-button" onClick={onClose}>Ahora no</button>
        </div>
        {!canPlay && game.copies_available <= 0 ? <small>No hay una copia disponible en este momento, pero el juego quedó instalado.</small> : null}
      </section>
    </div>
  );
}
