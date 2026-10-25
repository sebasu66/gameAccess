import { ArrowUpDown, X } from "lucide-react";
import FilledIcon from "./FilledIcon";
import { activeFilterTags, setCriterionState, type FilterTagGroup } from "./LibraryFilterDialog";
import { usePluginReady } from "./usePluginReady";
import { withoutSourceFilters } from "./librarySearch";
import { type LibrarySearchFilters } from "./librarySearch";
import type { CatalogSort } from "./librarySections";
import type { CatalogGame } from "./types";
import { useI18n } from "./i18n";
import { GaIconButton } from "./components/ga/Buttons";

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
    </div>
  );
}
