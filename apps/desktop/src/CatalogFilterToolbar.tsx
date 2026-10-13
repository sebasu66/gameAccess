import { ArrowUpDown, X } from "lucide-react";
import FilledIcon from "./FilledIcon";
import { activeFilterTags, setCriterionState } from "./LibraryFilterDialog";
import { DEFAULT_LIBRARY_FILTERS, filterLibraryGamesDetailed, hasNoActiveFilters, type LibrarySearchFilters } from "./librarySearch";
import type { CatalogSort } from "./librarySections";
import type { CatalogGame } from "./types";

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
  const active = activeFilterTags(filters);
  // A search that finds nothing looks identical to a search whose results were
  // all filtered away. Saying how many were hidden turns a dead end into an
  // explanation.
  const hidden = hasNoActiveFilters(filters) ? 0 : filterLibraryGamesDetailed(games, query, filters).hiddenCount;
  const clearCriterion = (group: "genres" | "features" | "sources", value: string) =>
    onFiltersChange(setCriterionState(filters, group, value, "off"));
  return (
    <div className="library-catalog-filter-actions">
      <button type="button" className="ga-filter-open" aria-haspopup="dialog" onClick={onOpenFilters}>
        <FilledIcon name="genres" />Filtros{active.length ? ` · ${active.length}` : ""}
      </button>
      <div className="ga-filter-tags" aria-label="Filtros activos">
        {active.length ? active.map(tag => <span key={`${tag.group}:${tag.value}`} className="ga-filter-tag">
          <button type="button" onClick={onOpenFilters}>{tag.label}</button>
          <button type="button" aria-label={`Quitar filtro ${tag.label}`} onClick={() => clearCriterion(tag.group, tag.value)}><X size={13} /></button>
        </span>) : <span className="ga-filter-any">Todos</span>}
      </div>
      <span className="ga-footer-divider" aria-hidden="true" />
      <details className="library-sort-dropdown">
        <summary aria-label={`Ordenar por ${selectedSortLabel}`} title={`Ordenar por: ${selectedSortLabel}`}><ArrowUpDown size={17} /><span>{selectedSortLabel}</span></summary>
        <div className="library-sort-menu" role="group" aria-label="Criterio de orden">
          {sortOptions.map(option => <button key={option.id} type="button" aria-pressed={catalogSort === option.id} onClick={event => { onSortChange(option.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{option.label}</button>)}
        </div>
      </details>
      {hidden > 0 ? <p className="ga-filter-hidden-notice" role="status">
        {hidden} {hidden === 1 ? "juego oculto" : "juegos ocultos"} por los filtros activos.
        <button type="button" onClick={() => onFiltersChange({ ...DEFAULT_LIBRARY_FILTERS })}>Quitar filtros</button>
      </p> : null}
    </div>
  );
}
