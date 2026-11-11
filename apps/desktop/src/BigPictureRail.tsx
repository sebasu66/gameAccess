/**
 * Big picture's side rail (Seba, 2026-11-10): search, how the games are ordered (last played, by name, by genre) and
 * leave. On the left, over the space the grid leaves free for it (body.ga-big-rail-on). Every button works with the
 * mouse, Tab and Enter, or the controller (left from the first column reaches it; right goes back to the games).
 */
import { createPortal } from "react-dom";
import { ArrowDownAZ, Clock, LogOut, Search, Tags, X } from "lucide-react";
import { GaButton, GaIconButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { BIG_PICTURE_ORDERS, setBigPictureOrder, setBigPictureQuery, useBigPictureView, type BigPictureOrder } from "./bigPicture";
import { MenuKey } from "./BigPictureIntro";
import "./big-picture-browse.css";

const ICONS: Record<BigPictureOrder, typeof Clock> = { recent: Clock, name: ArrowDownAZ, genre: Tags };
const LABELS = { recent: "bigPictureOrderRecent", name: "bigPictureOrderName", genre: "bigPictureOrderGenre" } as const;

export default function BigPictureRail({ onSearch, onExit }: { onSearch: () => void; onExit: () => void }) {
  const { t } = useI18n();
  const { order, query, input } = useBigPictureView();
  const pad = input === "pad";
  return createPortal(<nav className="ga-big-rail" aria-label={t("bigPictureRailLabel")}>
    <GaButton className="ga-big-rail-button" icon={<Search size={20} aria-hidden="true" />} onClick={onSearch}>
      <span>{t("bigPictureSearch")}</span>{pad ? <span className="ga-pad-key">X</span> : <kbd className="ga-pad-key">{t("bigKeySearch")}</kbd>}
    </GaButton>
    {query ? <div className="ga-big-rail-query">
      <span className="ga-hint">{t("bigPictureSearching")}</span>
      <strong className="ga-big-rail-query-text">{query}</strong>
      <GaIconButton icon={<X size={18} aria-hidden="true" />} label={t("bigPictureClearSearch")} onClick={() => setBigPictureQuery("")} />
    </div> : null}
    <div className="ga-group ga-big-rail-orders" role="radiogroup" aria-label={t("bigPictureOrder")}>
      <p className="ga-label">{t("bigPictureOrder")}{pad ? <span className="ga-pad-key">Y</span> : null}</p>
      {BIG_PICTURE_ORDERS.map(value => {
        const Icon = ICONS[value];
        return <GaButton key={value} role="radio" aria-checked={order === value} className="ga-big-rail-button ga-big-rail-order" icon={<Icon size={20} aria-hidden="true" />} onClick={() => setBigPictureOrder(value)}>
          <span>{t(LABELS[value])}</span>
        </GaButton>;
      })}
    </div>
    <GaButton className="ga-big-rail-button ga-big-rail-exit" icon={<LogOut size={20} aria-hidden="true" />} onClick={onExit}>
      <span>{t("bigPictureLeave")}</span>{pad ? <MenuKey /> : <kbd className="ga-pad-key">{t("bigKeyEsc")}</kbd>}
    </GaButton>
  </nav>, document.body);
}
