import { AlertTriangle, Loader2 } from "lucide-react";

import { useDialogFocus } from "./dialogFocus";
import type { CatalogGame } from "./types";

interface CancelDownloadDialogProps {
  game: CatalogGame;
  cancelling: boolean;
  error?: string | null;
  onKeep: () => void;
  onConfirm: () => void;
}

export default function CancelDownloadDialog({ game, cancelling, error, onKeep, onConfirm }: CancelDownloadDialogProps) {
  const dialogRef = useDialogFocus(onKeep);
  return (
    <div className="download-complete-backdrop" role="presentation">
      <section ref={dialogRef} className="download-complete-dialog" role="dialog" aria-modal="true" aria-label={`Cancelar descarga: ${game.name}`}>
        <span className="download-complete-icon"><AlertTriangle size={26} /></span>
        <span className="eyebrow">CANCELAR DESCARGA</span>
        <h2>¿Cancelar la descarga de {game.name}?</h2>
        <p>Los archivos parciales se conservan. GameAccess sólo detendrá el trabajo de esta descarga.</p>
        {error ? <p role="alert" className="download-cancel-error">{error}</p> : null}
        <div className="download-complete-actions">
          <button type="button" className="primary-button" data-dialog-initial disabled={cancelling} onClick={onKeep}>Seguir descargando</button>
          <button type="button" className="secondary-button" disabled={cancelling} onClick={onConfirm}>
            {cancelling ? <><Loader2 size={17} className="spin" /> Cancelando…</> : "Cancelar descarga"}
          </button>
        </div>
      </section>
    </div>
  );
}
