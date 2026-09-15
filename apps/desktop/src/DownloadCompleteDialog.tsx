import { Check, Play, X } from "lucide-react";

import { useDialogFocus } from "./dialogFocus";
import type { CatalogGame } from "./types";

interface DownloadCompleteDialogProps {
  game: CatalogGame;
  busy: boolean;
  onPlay: () => void;
  onClose: () => void;
}

export default function DownloadCompleteDialog({ game, busy, onPlay, onClose }: DownloadCompleteDialogProps) {
  const dialogRef = useDialogFocus(onClose);
  const displayName = game.name.replace(/\s+\+\s*$/, "").trim();
  const artwork = game.hero_image || game.header_image || game.capsule_image;
  const backgroundStyle = artwork ? {
    backgroundImage: `linear-gradient(90deg, rgba(5, 9, 14, .96) 0%, rgba(5, 9, 14, .82) 48%, rgba(5, 9, 14, .56) 100%), url(${JSON.stringify(artwork)})`,
  } : undefined;
  return (
    <div className="download-complete-backdrop" role="presentation">
      <section ref={dialogRef} className={`download-complete-dialog ${artwork ? "download-complete-dialog-ready" : ""}`} style={backgroundStyle} role="dialog" aria-modal="true" aria-label={`Descarga completa: ${displayName}`}>
        <button type="button" className="download-dialog-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <span className="download-complete-icon"><Check size={26} /></span>
        <span className="eyebrow">DESCARGA TERMINADA</span>
        <h2>{displayName}</h2>
        <p>Está listo para jugar.</p>
        <div className="download-complete-actions">
          <button type="button" className="primary-button" data-dialog-initial disabled={busy} onClick={onPlay}><Play size={18} fill="currentColor" /> Jugar ahora</button>
          <button type="button" className="secondary-button" onClick={onClose}>Ahora no</button>
        </div>
      </section>
    </div>
  );
}
