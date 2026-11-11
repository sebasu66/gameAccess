/**
 * The content header (vault/Rediseño de navegación.md §4.3), one piece for every section: in the gap right of the
 * title's arrow, the game search, a search over what is on screen, or a summary of two or three facts; in the corner,
 * the mode's picture cut as a parallelogram (in Downloads, the cover of the game that is coming down).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useActiveDownloads } from "../downloads/useActiveDownloadCount";
import { filterBlocks, headerKind, setHeaderSearchSlot } from "./headerSlot";
import { formatSpeed, useAppVersion } from "./statusBarData";

type Fact = { label: string; value: string };

/** A search over the blocks of the screen on show (settings groups, help topics): it filters while typing. */
function PageSearch({ section }: { section: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => setQuery(""), [section]);
  useEffect(() => {
    const screens = () => [...document.querySelectorAll<HTMLElement>(".ga-screen")].filter(screen => screen.offsetParent || getComputedStyle(screen).position === "fixed");
    const apply = () => { let count = 0; for (const screen of screens()) count += filterBlocks(screen, query); setShown(query.trim() ? count : null); };
    apply();
    // A new tab or a block that loads later is filtered too.
    const observer = new MutationObserver(() => { observer.disconnect(); apply(); for (const screen of screens()) observer.observe(screen, { childList: true, subtree: true }); });
    for (const screen of screens()) observer.observe(screen, { childList: true, subtree: true });
    return () => { observer.disconnect(); for (const screen of screens()) filterBlocks(screen, ""); };
  }, [query, section]);
  return <div className="ga-nav-head-search">
    <label className="ga-nav-head-field">
      <Search aria-hidden="true" />
      <input data-ga-head-search="" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("navSearchPage")} aria-label={t("navSearchPage")} autoComplete="off"
        onKeyDown={event => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); } }} />
      {query ? <button type="button" onClick={() => setQuery("")} aria-label={t("uiLimpiarBusqueda")}><X aria-hidden="true" /></button> : null}
    </label>
    {shown === 0 ? <p className="ga-nav-head-note" role="status">{t("navSearchNone", { q: query.trim() })}</p> : null}
  </div>;
}

/** The slot the catalog panel draws the one game search into (headerSlot.ts). */
function GameSearchSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { setHeaderSearchSlot(ref.current); return () => setHeaderSearchSlot(null); }, []);
  return <div className="ga-nav-head-search ga-nav-head-games" ref={ref} />;
}

function Summary({ facts }: { facts: Fact[] }) {
  if (!facts.length) return null;
  return <dl className="ga-nav-head-summary">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

export default function ContentHeader({ section, plan, unread }: { section: string; plan: string; unread: number }) {
  const { t, locale } = useI18n();
  const downloads = useActiveDownloads();
  const version = useAppVersion();
  const kind = headerKind(section);
  const facts: Fact[] = section === "downloads"
    ? [{ label: t("navSumActive"), value: String(downloads.count - downloads.queued) }, { label: t("navSumQueued"), value: String(downloads.queued) }, { label: t("navSumSpeed"), value: formatSpeed(downloads.speedBps, locale) }]
    : section === "news" ? [{ label: t("navSumUnread"), value: String(unread) }, ...(version ? [{ label: t("navSumVersion"), value: version }] : [])]
    : section === "account" || section === "subscription" ? [{ label: t("navSumPlan"), value: plan }]
    : [];
  const cover = section === "downloads" ? downloads.cover : undefined;
  return <header className="ga-nav-head" aria-label={t("navHeadAria")}>
    <div className="ga-nav-head-main">
      {kind === "games" ? <GameSearchSlot /> : kind === "page" ? <PageSearch section={section} /> : <Summary facts={facts} />}
    </div>
    <i className="ga-nav-head-art" aria-hidden="true" style={cover ? { "--ga-nav-head-image": `url("${cover}")` } as React.CSSProperties : undefined} />
  </header>;
}
