import { Check, Play, X } from "lucide-react";

import { useDialogFocus } from "./dialogFocus";
import { playAvailability } from "./gameAvailability";
import type { CatalogGame } from "./types";

interface DownloadCompleteDialogProps {
  game: CatalogGame;
  busy: boolean;
  onPlay: () => void;
  onClose: () => void;
}

export default function DownloadCompleteDialog({ game, busy, onPlay, onClose }: DownloadCompleteDialogProps) {
  const availability = playAvailability(game, busy);
  const dialogRef = useDialogFocus(onClose);
  return (
    <div className="download-complete-backdrop" role="presentation">
      <section ref={dialogRef} className="download-complete-dialog" role="dialog" aria-modal="true" aria-label={`Descarga completa: ${game.name}`}>
        <button type="button" className="download-dialog-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <span className="download-complete-icon"><Check size={26} /></span>
        <span className="eyebrow">DESCARGA TERMINADA</span>
        <h2>{game.name} ya está listo para jugar</h2>
        <p>La instalación quedó confirmada y persistida. ¿Querés jugar ahora?</p>
        <div className="download-complete-actions">
          <button type="button" className="primary-button" data-dialog-initial disabled={!availability.allowed} onClick={onPlay}><Play size={18} fill="currentColor" /> Jugar ahora</button>
          <button type="button" className="secondary-button" onClick={onClose}>Ahora no</button>
        </div>
        {!availability.allowed && availability.reason ? <small>{availability.reason}</small> : null}
      </section>
    </div>
  );
}
