import { GaClose } from "../components/ga/Buttons";
import { useDialogFocus } from "../dialogFocus";
import { useI18n } from "../i18n";
import ManualDownloadForm from "../ManualDownloadForm";

/** "Add a link": a download the user pastes by hand (HTTP/HTTPS or magnet) for a game picked from the catalog, without the
 *  download plugin. It was folded at the end of the manager's list, where nobody found it: now it has its own button. */
export default function ManualLinkDialog({ onClose, url = "", query = "" }: { onClose: () => void; url?: string; query?: string }) {
  const { t } = useI18n();
  const ref = useDialogFocus(onClose);
  return <div className="ga-settings-backdrop" onPointerDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="ga-settings-panel ga-manual-link" role="dialog" aria-modal="true" aria-labelledby="manual-link-title">
      <header><div><h2 id="manual-link-title">{t("manualDownloadAdd")}</h2></div><GaClose label={t("close")} onClick={onClose} data-dialog-initial /></header>
      <div className="ga-settings-content">
        <p className="ga-hint">{t("manualDownloadHint")}</p>
        <ManualDownloadForm onDone={onClose} initialUrl={url} initialQuery={query} />
      </div>
    </section>
  </div>;
}
