/**
 * The detail's Downloads tab (Seba, 2026-11-17): a direct download starts only here. Every source the plugins found is
 * a row with what it is (title, origin, size) and its own Download button; the first one is the recommended. Pressing
 * Download asks first, in a dialog with the game, the source, its size and the room left on the games disk.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, Link2, Loader2 } from "lucide-react";
import AppDialog from "./AppDialog";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { digitalCatalogService, GameAlreadyInstalledError } from "./catalog/DigitalCatalog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import type { PluginSource } from "./catalog/PluginSources";
import { formatDownloadBytes, parseDownloadSize } from "./downloadSize";
import { useLibraryScan } from "./libraryScan";
import { sourceLessonText } from "./PluginDownloadButton";
import ManualLinkDialog from "./library-manager/ManualLinkDialog";
import { notify } from "./toasts";
import type { CatalogGame } from "./types";

function ConfirmDownload({ game, source, onClose }: { game: CatalogGame; source: PluginSource; onClose: () => void }) {
  const { t } = useI18n();
  const free = useLibraryScan().summary?.disk_free_bytes;
  const bytes = parseDownloadSize(source.size);
  const short = bytes != null && free != null && bytes > free;
  const [working, setWorking] = useState(false);
  const start = async () => {
    setWorking(true);
    try {
      await digitalCatalogService.download(game, source);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof GameAlreadyInstalledError)) digitalDownloadService.recordFailure(game, message);
      notify(t("detailDownloadFailed", { error: message }), { tone: "error" });
      setWorking(false);
    }
  };
  return <AppDialog title={t("detailDownloadConfirmTitle", { name: game.name })} message={t("detailDownloadConfirmText")} tone={short || source.lesson ? "warning" : "info"}
    confirmLabel={t("detailDownloadAction")} cancelLabel={t("noticeCancel")} initialAction="confirm" confirmDisabled={working}
    progress={working ? { phase: "working", label: t("detailDownloadStarting") } : undefined} onConfirm={() => void start()} onClose={onClose}>
    <dl className="ga-detail-dl-facts">
      <div><dt>{t("detailDownloadFile")}</dt><dd>{source.title}</dd></div>
      <div><dt>{t("detailDownloadOrigin")}</dt><dd>{source.sourceName}{source.delivery === "browser" ? ` · ${t("detailDownloadBrowser")}` : ""}</dd></div>
      <div><dt>{t("detailDownloadSize")}</dt><dd>{source.size || t("downloadsSizeUnknown")}</dd></div>
      {free != null ? <div><dt>{t("detailDownloadFree")}</dt><dd>{formatDownloadBytes(free)}</dd></div> : null}
    </dl>
    {short ? <p className="ga-status is-warn">{t("detailDownloadNoRoom")}</p> : null}
    {source.lesson ? <p className="ga-status is-warn">{sourceLessonText(source, t)}</p> : null}
  </AppDialog>;
}

/** `compact` (the detail's right column, Seba 2026-11-17): the title wraps, the download is an icon-only cube and a hover shows it all. */
export default function DetailDownloads({ game, sources, compact = false }: { game: CatalogGame; sources: PluginSource[] | null; compact?: boolean }) {
  const { t } = useI18n();
  const [asking, setAsking] = useState<PluginSource | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  if (sources === null) return <p role="status" className="ga-detail-dl-wait"><Loader2 className="spin" aria-hidden="true" />{t("sourcesChecking")}</p>;
  return <div className="ga-detail-dl">
    <p className="ga-detail-dl-intro">{t("detailDownloadIntro", { count: sources.length })}</p>
    <ul className="ga-detail-dl-list">
      {sources.map((source, index) => { const meta = [source.sourceName, source.size || t("downloadsSizeUnknown"), source.delivery === "browser" ? t("detailDownloadBrowser") : ""].filter(Boolean).join(" · "); return <li key={source.url} className={`ga-detail-dl-row${index === 0 && !source.lesson ? " is-best" : ""}${compact ? " is-compact" : ""}`} title={compact ? [source.title, meta, source.lesson ? sourceLessonText(source, t) : ""].filter(Boolean).join("\n") : undefined}>
        <div className="ga-detail-dl-text">
          {index === 0 && !source.lesson ? <span className="ga-detail-dl-best">{t("detailDownloadBest")}</span> : null}
          <strong title={compact ? undefined : source.title}>{source.title}</strong>
          <span>{meta}</span>
          {source.lesson ? <em className="ga-detail-dl-lesson">{sourceLessonText(source, t)}</em> : null}
        </div>
        {compact ? <GaButton variant={index === 0 && !source.lesson ? "primary" : "secondary"} className="ga-detail-dl-cube" icon={<Download size={18} aria-hidden="true" />} aria-label={`${t("detailDownloadAction")}: ${source.title}`} title={t("detailDownloadAction")} onClick={() => setAsking(source)} />
          : <GaButton variant={index === 0 && !source.lesson ? "primary" : "secondary"} icon={<Download size={18} aria-hidden="true" />} onClick={() => setAsking(source)}>{t("detailDownloadAction")}</GaButton>}
      </li>; })}
    </ul>
    <GaButton className="ga-detail-dl-link" icon={<Link2 size={18} aria-hidden="true" />} onClick={() => setLinkOpen(true)}>{t("manualDownloadAdd")}</GaButton>
    {/* Out of the tab's scrolling, masked pane: the dialog covers the whole window. */}
    {asking ? createPortal(<ConfirmDownload game={game} source={asking} onClose={() => setAsking(null)} />, document.body) : null}
    {linkOpen ? createPortal(<ManualLinkDialog query={game.name} onClose={() => setLinkOpen(false)} />, document.body) : null}
  </div>;
}
