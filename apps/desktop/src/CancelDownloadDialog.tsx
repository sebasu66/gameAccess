import { AlertTriangle, Loader2 } from "lucide-react";

import { useDialogFocus } from "./dialogFocus";
import { useI18n } from "./i18n";
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
  const { t } = useI18n();
  return (
    <div className="download-complete-backdrop" role="presentation">
      <section ref={dialogRef} className="download-complete-dialog" role="dialog" aria-modal="true" aria-label={t("cancelDownloadAria", { name: game.name })}>
        <span className="download-complete-icon"><AlertTriangle size={26} /></span>
        <span className="eyebrow">{t("cancelDownload")}</span>
        <h2>{t("cancelDownloadTitle", { name: game.name })}</h2>
        <p>{t("cancelDownloadBody")}</p>
        {error ? <p role="alert" className="download-cancel-error">{error}</p> : null}
        <div className="download-complete-actions">
          <button type="button" className="primary-button" data-dialog-initial disabled={cancelling} onClick={onKeep}>{t("keepDownloading")}</button>
          <button type="button" className="secondary-button" disabled={cancelling} onClick={onConfirm}>
            {cancelling ? <><Loader2 size={17} className="spin" /> {t("cancelling")}</> : t("cancelDownload")}
          </button>
        </div>
      </section>
    </div>
  );
}
