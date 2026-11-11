import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDownToLine, BookOpen, CircleHelp, Crown, Heart, Lightbulb, Megaphone, Palette, Play, Plug, Rows3, Search,
  ShieldCheck, SlidersHorizontal, Sparkles, Star, User, type LucideIcon,
} from "lucide-react";
import { useI18n } from "../i18n";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";
import { sectionListOrder, selectNavigationTab, tabReady, useSectionTab } from "./navigationSelection";
import { currentCssValue, SHELL_LOOK_EVENT } from "./shellLook";

/** A descriptive icon per section; none repeats a mode's icon (§4.2: Manager is a table with rows, not the catalog's grid). */
const SECTION_ICONS: Record<string, LucideIcon> = {
  explore: Search, smartSearch: Sparkles, aiSuggestions: Lightbulb, newGames: Star, tasteProfile: Heart,
  play: Play, downloads: ArrowDownToLine, manager: Rows3,
  news: Megaphone, guide: BookOpen, account: User, subscription: Crown, help: CircleHelp,
  general: SlidersHorizontal, appearance: Palette, plugins: Plug, parental: ShieldCheck,
};

/** Texts that do not fit shrink down to the template's least size; they never spill (also after the fonts load). */
function shrinkToFit(root: HTMLElement): void {
  const least = parseFloat(currentCssValue("--ga-nav-fit-min")) || 1;
  root.querySelectorAll<HTMLElement>("[data-fit]").forEach(el => {
    el.style.fontSize = "";
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > least) { size -= 1; el.style.fontSize = `${size}px`; }
  });
}

function Chevrons({ big }: { big?: boolean }) {
  return <span className={big ? "ga-nav-chevrons ga-nav-chevrons-big" : "ga-nav-chevrons"} aria-hidden="true">
    {[0, 1, 2].map(index => <i key={index} style={{ "--ga-nav-chevron-i": index } as React.CSSProperties} />)}
  </span>;
}

/** The sections panel (vault/Rediseño de navegación.md §4.2): the chosen section as a title that reaches over the content, the others as stepped arrows. */
export default function SectionPanel({ mode, selected, reachable, onOpen }: { mode: NavigationModeId; selected: string; reachable: (section: string) => boolean; onOpen: (section: string) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const current = NAVIGATION.find(item => item.id === mode)!;
  const ids = current.sections.map(section => section.id as string);
  const chosen = current.sections.find(section => section.id === selected) ?? current.sections[0];
  const tab = useSectionTab(chosen.id);
  const [orders, setOrders] = useState<Partial<Record<NavigationModeId, string[]>>>({});
  const order = sectionListOrder(ids, chosen.id, orders[mode]);
  if (orders[mode]?.join() !== order.join()) setOrders(previous => ({ ...previous, [mode]: order }));

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fit = () => shrinkToFit(root);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    // A new style or font changes the measures without resizing anything: fit again once it is drawn and loaded.
    const restyled = () => requestAnimationFrame(() => { fit(); void document.fonts?.ready.then(fit); });
    window.addEventListener(SHELL_LOOK_EVENT, restyled);
    // A style's font loads the first time it is used, after the look changed: fit again when it arrives.
    document.fonts?.addEventListener("loadingdone", fit);
    void document.fonts?.ready.then(fit);
    return () => { observer.disconnect(); window.removeEventListener(SHELL_LOOK_EVENT, restyled); document.fonts?.removeEventListener("loadingdone", fit); };
  }, [mode, chosen.id, t]);

  return <nav className="ga-nav-sections" ref={ref} aria-label={t("navSectionsAria")}>
    <div className="ga-nav-panel-art" aria-hidden="true">
      <i className="ga-nav-panel-image" /><i className="ga-nav-panel-tint" /><i className="ga-nav-panel-shade" /><i className="ga-nav-panel-scan" />
      <span className="ga-nav-panel-stripes"><i /><i /><i /></span>
    </div>
    <div className="ga-nav-hero">
      <div className="ga-nav-hero-plate">
        <h2 className="ga-nav-hero-name" data-fit="">{t(chosen.label)}</h2>
        <p className="ga-nav-hero-desc">{t(chosen.desc)}</p>
      </div>
      <Chevrons big />
    </div>
    <div className="ga-nav-panel-flow">
    {chosen.tabs.length ? <ul className="ga-nav-tabs" aria-label={t(chosen.label)}>{chosen.tabs.map(item => <li key={item.id}>
      <button type="button" className="ga-nav-tab" aria-current={item.id === tab ? "page" : undefined} disabled={!tabReady(chosen.id, item.id)}
        onClick={() => selectNavigationTab(mode, chosen.id, item.id)}><span data-fit="">{t(item.label)}</span></button>
    </li>)}</ul> : null}
    <ul className="ga-nav-section-list">{order.map((id, index) => {
      const section = current.sections.find(item => item.id === id)!;
      const Icon = SECTION_ICONS[id] ?? Search;
      return <li key={id} style={{ "--ga-nav-step": index } as React.CSSProperties}>
        <button type="button" className="ga-nav-section" disabled={!reachable(id)} onClick={() => onOpen(id)}>
          <span className="ga-nav-section-shape" aria-hidden="true" />
          <span className="ga-nav-section-icon" aria-hidden="true"><Icon /></span>
          <span className="ga-nav-section-text">
            <span className="ga-nav-section-name" data-fit="">{t(section.label)}</span>
            <span className="ga-nav-section-desc">{t(section.desc)}</span>
          </span>
          <Chevrons />
        </button>
      </li>;
    })}</ul>
    </div>
  </nav>;
}
