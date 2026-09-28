import { AlertTriangle, Loader2 } from "lucide-react";

import { useDialogFocus } from "./dialogFocus";
import type { CatalogGame } from "./types";

interface SteamInstallFallbackDialogProps {
  game: CatalogGame;
  busy: boolean;
  error?: string | null;
  onContinue: () => void;
  onClose: () => void;
}

export default function SteamInstallFallbackDialog({ game, busy, error, onContinue, onClose }: SteamInstallFallbackDialogProps) {
  const dialogRef = useDialogFocus(onClose);
  return (
    <div className="session-backdrop" role="presentation">
      <section ref={dialogRef} className="session-card" style={game.hero_image ? { backgroundImage: `url("${game.hero_image}")` } : undefined} role="dialog" aria-modal="true" aria-labelledby="steam-install-fallback-title">
        <div className="session-shade" />
        <div className="session-content">
          <div className="session-status-icon error"><AlertTriangle size={28} /></div>
          <span className="eyebrow">INSTALACIÓN DESDE STEAM</span>
          <h2 id="steam-install-fallback-title">No se pudo preinstalar {game.name}</h2>
          <p>Vamos a iniciar sesión en Steam para que puedas instalarlo manualmente desde el cliente.</p>
          {error ? <p className="steam-install-fallback-error" role="alert">No se pudo continuar: {error}</p> : null}
          <div className="download-complete-actions">
            <button type="button" className="primary-button" data-dialog-initial disabled={busy} onClick={onContinue}>
              {busy ? <><Loader2 size={17} className="spin" /> Preparando Steam…</> : "Continuar en Steam"}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Ahora no</button>
          </div>
        </div>
      </section>
    </div>
  );
}
