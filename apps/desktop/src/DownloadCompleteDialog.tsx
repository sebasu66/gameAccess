import { Check, Play, X } from "lucide-react";

import { useDialogFocus } from "./dialogFocus";
import { useI18n } from "./i18n";
import type { CatalogGame } from "./types";

interface DownloadCompleteDialogProps {
  game: CatalogGame;
  busy: boolean;
  onPlay: () => void;
  onClose: () => void;
}

export default function DownloadCompleteDialog({ game, busy, onPlay, onClose }: DownloadCompleteDialogProps) {
  const dialogRef = useDialogFocus(onClose);
  const { t } = useI18n();
  const displayName = game.name.replace(/\s+\+\s*$/, "").trim();
  const artwork = game.hero_image || game.header_image || game.capsule_image;
  const backgroundStyle = artwork ? {
    backgroundImage: `linear-gradient(90deg, rgba(5, 9, 14, .96) 0%, rgba(5, 9, 14, .82) 48%, rgba(5, 9, 14, .56) 100%), url(${JSON.stringify(artwork)})`,
  } : undefined;
  return (
    <div className="download-complete-backdrop" role="presentation">
      <section ref={dialogRef} className={`download-complete-dialog ${artwork ? "download-complete-dialog-ready" : ""}`} style={backgroundStyle} role="dialog" aria-modal="true" aria-label={t("downloadCompleteAria", { name: displayName })}>
        <button type="button" className="download-dialog-close" onClick={onClose} aria-label={t("close")}><X size={18} /></button>
        <span className="download-complete-icon"><Check size={26} /></span>
        <span className="eyebrow">{t("downloadComplete")}</span>
        <h2>{displayName}</h2>
        <p>{t("readyToPlay")}</p>
        <div className="download-complete-actions">
          <button type="button" className="primary-button" data-dialog-initial disabled={busy} onClick={onPlay}><Play size={18} fill="currentColor" /> {t("playNow")}</button>
          <button type="button" className="secondary-button" onClick={onClose}>{t("notNow")}</button>
        </div>
      </section>
    </div>
  );
}
