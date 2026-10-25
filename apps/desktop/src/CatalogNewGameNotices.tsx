import { useEffect } from "react";
import { X } from "lucide-react";
import DigitalDownloadArtwork from "./DigitalDownloadArtwork";
import type { CatalogGame } from "./types";
import { CATALOG_NOTICE_DURATION } from "./catalogUpdates";
import { useI18n } from "./i18n";

export type CatalogNotice = { key: number; game: CatalogGame; createdAt: number };
function Notice({ notice, dismiss }: { notice: CatalogNotice; dismiss: (key: number) => void }) {
  const {t}=useI18n();
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(notice.key), Math.max(0, notice.createdAt + CATALOG_NOTICE_DURATION - Date.now()));
    return () => window.clearTimeout(timer);
  }, [notice.key, notice.createdAt, dismiss]);
  return <article className="ga-catalog-notice">
    <span className="ga-catalog-notice-art"><DigitalDownloadArtwork game={notice.game}/></span>
    <div><span className="ga-catalog-notice-label">{t("catalogNewGame")}</span><strong>{notice.game.name}</strong><span>{t("catalogNewGameHelp")}</span></div>
    <button type="button" aria-label={t("catalogNoticeClose",{name:notice.game.name})} onClick={() => dismiss(notice.key)}><X size={17}/></button>
  </article>;
}
export default function CatalogNewGameNotices({ notices, dismiss }: { notices: CatalogNotice[]; dismiss: (key: number) => void }) {
  const {t}=useI18n();
  return <aside className="ga-catalog-notices" aria-label={t("catalogNewGames")} aria-live="polite" aria-relevant="additions">
    {notices.map(notice => <Notice key={notice.key} notice={notice} dismiss={dismiss}/>) }
  </aside>;
}
