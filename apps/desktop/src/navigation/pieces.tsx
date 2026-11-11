/**
 * The shell's shared pieces (vault/Rediseño de navegación.md §4): every panel, title and menu of the new interface is
 * drawn with these, so a change to one piece, its template variables or a style reaches every section the same way.
 * Shape and measures live in templates/base.css, look in the flavor layer, and navigation-shell.css only reads them.
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Lock } from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import type { NavigationModeId } from "./navigationTree";
import { NAVIGATION } from "./navigationTree";
import { selectNavigationTab, tabReady, useSectionTab } from "./navigationSelection";
import { usePlus } from "../kidMode";
import { planLocked } from "./planLocks";
import { currentCssValue, SHELL_LOOK_EVENT } from "./shellLook";
import { packPills } from "./pillRows";

/** Texts marked `data-fit` that do not fit shrink down to the template's least size; they never spill. */
export function shrinkToFit(root: HTMLElement): void {
  const least = parseFloat(currentCssValue("--ga-nav-fit-min")) || 1;
  root.querySelectorAll<HTMLElement>("[data-fit]").forEach(el => {
    el.style.fontSize = "";
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > least) { size -= 1; el.style.fontSize = `${size}px`; }
  });
}

/** Keeps every `data-fit` text inside `ref` fitted: on resize, on a new style and when a style's font arrives. */
export function useFitText(ref: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fit = () => shrinkToFit(root);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    // A text's room can change without the root resizing (a new layout rule): watch each fitted text too.
    root.querySelectorAll<HTMLElement>("[data-fit]").forEach(el => observer.observe(el));
    // A new style or font changes the measures without resizing anything: fit again once it is drawn and loaded.
    const restyled = () => requestAnimationFrame(() => { fit(); void document.fonts?.ready.then(fit); });
    window.addEventListener(SHELL_LOOK_EVENT, restyled);
    document.fonts?.addEventListener("loadingdone", fit);
    void document.fonts?.ready.then(fit);
    return () => { observer.disconnect(); window.removeEventListener(SHELL_LOOK_EVENT, restyled); document.fonts?.removeEventListener("loadingdone", fit); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Three chevrons after an arrow: small on a section button, big after the title. */
export function Chevrons({ big }: { big?: boolean }) {
  return <span className={big ? "ga-nav-chevrons ga-nav-chevrons-big" : "ga-nav-chevrons"} aria-hidden="true">
    {[0, 1, 2].map(index => <i key={index} style={{ "--ga-nav-chevron-i": index } as React.CSSProperties} />)}
  </span>;
}

/** The mode's image under its tint, shade and scan lines, with the three stripes in the corner. */
export function PanelArt() {
  return <div className="ga-nav-panel-art" aria-hidden="true">
    <i className="ga-nav-panel-image" /><i className="ga-nav-panel-tint" /><i className="ga-nav-panel-shade" /><i className="ga-nav-panel-fade" /><i className="ga-nav-panel-scan" />
  </div>;
}

/** The chosen section as a title in an arrow that reaches over the content (§4.2). */
export function TitlePlate({ name, desc }: { name: string; desc: string }) {
  return <div className="ga-nav-hero">
    <div className="ga-nav-hero-plate">
      <h2 className="ga-nav-hero-name" data-fit="">{name}</h2>
      <p className="ga-nav-hero-desc">{desc}</p>
    </div>
    <Chevrons big />
  </div>;
}

/** A white padlock beside a name the plan does not include; on hover it says «Disponible en PLUS» (§5.12). */
export function PlanLock({ inline }: {
  /** After a section's name, like one more letter: a solid padlock in PLUS gold (Seba, 2026-11-11). */
  inline?: boolean;
}) {
  const { t } = useI18n();
  return <span className={inline ? "ga-nav-lock ga-nav-lock-inline" : "ga-nav-lock"} data-tip={t("navPlusOnly")} role="img" aria-label={t("navPlusOnly")}>
    {inline ? <svg viewBox="0 0 24 24" aria-hidden="true"><path className="ga-nav-lock-shackle" d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" /><rect x="4" y="10" width="16" height="12" rx="2.5" /></svg> : <Lock aria-hidden="true" />}
  </span>;
}

/** The pills' drawn order (pillRows.ts), measured again on a resize, a new style or a font that arrives. */
function usePillOrder(key: string): { list: RefObject<HTMLUListElement>; ref: number[] } {
  const list = useRef<HTMLUListElement>(null);
  const [order, setOrder] = useState<number[]>([]);
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const pack = () => {
      const style = getComputedStyle(root);
      const room = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const widths: number[] = [];
      root.querySelectorAll<HTMLElement>(":scope > li[data-pill]").forEach(li => { widths[Number(li.dataset.pill)] = li.getBoundingClientRect().width; });
      const next = packPills(widths, room, parseFloat(style.columnGap) || 0);
      setOrder(prev => prev.join() === next.join() ? prev : next);
    };
    pack();
    const observer = new ResizeObserver(pack);
    observer.observe(root);
    // A pill can change size without the list doing so (a new font or letter size): watch each one too.
    root.querySelectorAll(":scope > li").forEach(li => observer.observe(li));
    const restyled = () => requestAnimationFrame(pack);
    window.addEventListener(SHELL_LOOK_EVENT, restyled);
    document.fonts?.addEventListener("loadingdone", pack);
    void document.fonts?.ready.then(pack);
    return () => { observer.disconnect(); window.removeEventListener(SHELL_LOOK_EVENT, restyled); document.fonts?.removeEventListener("loadingdone", pack); };
  }, [key]);
  return { list, ref: order };
}

/** A section's submodes, from the navigation tree, as pills that fill their rows: the chosen one filled with its dot lit, the ones
 *  without a screen yet dimmed, the ones outside the plan as usual with a padlock (a click opens the plans). */
export function SubmodeTabs({ mode, section, onLocked }: { mode: NavigationModeId; section: string; onLocked: () => void }) {
  const { t } = useI18n();
  const plus = usePlus();
  const found = NAVIGATION.find(item => item.id === mode)?.sections.find(item => item.id === section);
  const chosen = useSectionTab(section);
  const tabs: readonly { id: string; label: TranslationKey }[] = found?.tabs ?? [];
  const order = usePillOrder(tabs.map(item => item.id).join(" "));
  if (!tabs.length) return null;
  const drawn = order.ref.length === tabs.length ? order.ref.map(index => tabs[index]) : tabs;
  return <ul className="ga-nav-tabs" ref={order.list} aria-label={t(found!.label)}>{drawn.map(item => {
    const locked = planLocked(plus, section, item.id);
    return <li key={item.id} data-pill={tabs.indexOf(item)}>
      <button type="button" className="ga-nav-tab" aria-current={!locked && item.id === chosen ? "page" : undefined} data-locked={locked || undefined} disabled={!locked && !tabReady(section, item.id)}
        onClick={() => locked ? onLocked() : selectNavigationTab(mode, section, item.id)}><i className="ga-nav-tab-dot" aria-hidden="true" /><span>{t(item.label)}</span>{locked ? <PlanLock /> : null}</button>
    </li>;
  })}</ul>;
}

/** One section as an arrow: its icon as an oversized watermark on the left, name, description and the chevrons that light on hover. */
export function SectionButton({ art, label, desc, disabled, locked, onClick }: {
  /** The section's line drawing (sectionArt.tsx), shown as a watermark. */
  art: ReactNode; label: TranslationKey; desc: TranslationKey; disabled?: boolean;
  /** Outside the player's plan: drawn as usual with a padlock, and the click opens the plans. */
  locked?: boolean; onClick: () => void;
}) {
  const { t } = useI18n();
  return <li>
    <button type="button" className="ga-nav-section" data-locked={locked || undefined} disabled={disabled && !locked} onClick={onClick}>
      {/* The icon is a watermark larger than the button, cut by its left edge (inside the shape, which clips it). */}
      <span className="ga-nav-section-shape" aria-hidden="true"><span className="ga-nav-section-mark">{art}</span></span>
      <span className="ga-nav-section-text">
        <span className="ga-nav-section-title"><span className="ga-nav-section-name" data-fit="">{t(label)}</span>{locked ? <PlanLock inline /> : null}</span>
        <span className="ga-nav-section-desc">{t(desc)}</span>
      </span>
      <Chevrons />
    </button>
  </li>;
}
