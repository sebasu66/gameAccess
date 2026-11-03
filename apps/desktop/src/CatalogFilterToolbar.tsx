import { useEffect, useRef } from "react";
import { ArrowUpDown, Sparkles, X } from "lucide-react";
import FilledIcon from "./FilledIcon";
import { activeFilterTags, setCriterionState, type FilterTagGroup } from "./LibraryFilterDialog";
import { usePluginReady } from "./usePluginReady";
import { withoutSourceFilters } from "./librarySearch";
import { type LibrarySearchFilters } from "./librarySearch";
import type { CatalogSort } from "./librarySections";
import type { CatalogGame } from "./types";
import { useI18n } from "./i18n";
import { GaIconButton } from "./components/ga/Buttons";
import { setPersonalOrder, unlockCelebrated, usePersonalOrder } from "./personalOrder";
import { gsap, motionOk } from "./motion/gsap";
import { playUnlockChime } from "./uiSounds";

/**
 * The "personalized order" switch (personalOrder.ts). Unavailable until the taste profile is ready, with a tooltip
 * saying why; the moment it becomes available it swells, glows and chimes, so the player notices it.
 */
function PersonalOrderSwitch() {
  const { t } = useI18n();
  const { on, ready, percent, unlocked } = usePersonalOrder();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!unlocked || !button.current) return;
    const element = button.current;
    // The thumb that completes the profile is usually given in a game's detail: celebrate once it is closed.
    let timer = 0;
    const celebrate = () => {
      if (document.querySelector(".ga-detail-overlay")) { timer = window.setTimeout(celebrate, 300); return; }
      timer = window.setTimeout(() => {
        unlockCelebrated();
        playUnlockChime();
        element.classList.add("is-unlocked");
        const done = () => element.classList.remove("is-unlocked");
        if (!motionOk()) { window.setTimeout(done, 2400); return; }
        gsap.timeline({ onComplete: done })
          .to(element, { scale: 1.35, duration: .22, ease: "back.out(3)" })
          .to(element, { scale: .92, duration: .16, ease: "power2.in" })
          .to(element, { scale: 1.12, duration: .18, ease: "power2.out" })
          .to(element, { scale: 1, duration: .5, ease: "elastic.out(1, .4)", clearProps: "transform" })
          .to({}, { duration: 1.4 });
      }, 450);
    };
    celebrate();
    return () => window.clearTimeout(timer);
  }, [unlocked]);
  const label = t("personalOrderLabel");
  const tip = !ready ? t("personalOrderLocked", { percent }) : on ? t("personalOrderOn") : t("personalOrderOff");
  return <button ref={button} type="button" className={`ga-cube ga-personal-order${on && ready ? " is-on" : ""}`} aria-pressed={on && ready} aria-disabled={!ready} aria-label={`${label}. ${tip}`} title={tip}
    onClick={() => { if (ready) setPersonalOrder(!on); }}><Sparkles size={18} aria-hidden="true" /><span className="ga-cube-label">{label}</span></button>;
}

/**
 * The filter bar above the catalog grid: which filters are active, how to remove
 * one, the sort control, and how many games the active filters are hiding.
 *
 * Kept out of the catalog panel because that component already carries the grid,
 * the virtual window and the context menu, and this is the one part of it that
 * is only about describing the current filter state.
 */
export default function CatalogFilterToolbar({ games, query, filters, sortOptions, selectedSortLabel, catalogSort, onSortChange, onFiltersChange, onOpenFilters }: {
  games: CatalogGame[];
  query: string;
  filters: LibrarySearchFilters;
  sortOptions: { id: CatalogSort; label: string }[];
  selectedSortLabel: string;
  catalogSort: CatalogSort;
  onSortChange: (sort: CatalogSort) => void;
  onFiltersChange: (filters: LibrarySearchFilters) => void;
  onOpenFilters: () => void;
}) {
  const { t } = useI18n();
  // Source criteria count only while a source plugin is ready (they do not apply without one).
  const pluginReady = usePluginReady();
  const active = activeFilterTags(pluginReady === false ? withoutSourceFilters(filters) : filters);
  const clearCriterion = (group: FilterTagGroup, value: string) => {
    if (group === "rating") {
      onFiltersChange({ ...filters, minReviewScore: undefined });
    } else if (group === "reviews") {
      onFiltersChange({ ...filters, minReviewCount: undefined });
    } else if (group === "age") {
      onFiltersChange({ ...filters, maxAgeDays: undefined });
    } else {
      onFiltersChange(setCriterionState(filters, group, value, "off"));
    }
  };
  return (
    <div className="library-catalog-filter-actions">
      <GaIconButton className="ga-filter-open" aria-haspopup="dialog" icon={<FilledIcon name="genres" />} label={t("uiFiltros")} badge={active.length} onClick={onOpenFilters} />
      <div className="ga-filter-tags" aria-label={t("uiFiltrosActivos")}>
        {active.length ? active.map(tag => <span key={`${tag.group}:${tag.value}`} className="ga-filter-tag">
          <button type="button" onClick={onOpenFilters}>{tag.label}</button>
          <button type="button" aria-label={t("removeFilterAria", { label: tag.label })} onClick={() => clearCriterion(tag.group, tag.value)}><X size={13} /></button>
        </span>) : <span className="ga-filter-any">{t("uiTodos")}</span>}
      </div>
      <span className="ga-footer-divider" aria-hidden="true" />
      <details className="library-sort-dropdown">
        <summary className="ga-cube" aria-label={t("sortByAria", { label: selectedSortLabel })} title={t("sortByTitle", { label: selectedSortLabel })}><ArrowUpDown size={19} aria-hidden="true" /><span className="ga-cube-label">{selectedSortLabel}</span></summary>
        <div className="library-sort-menu" role="group" aria-label={t("uiCriterioDeOrden")}>
          {sortOptions.map(option => <button key={option.id} type="button" aria-pressed={catalogSort === option.id} onClick={event => { onSortChange(option.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{option.label}</button>)}
        </div>
      </details>
      <PersonalOrderSwitch />
    </div>
  );
}
