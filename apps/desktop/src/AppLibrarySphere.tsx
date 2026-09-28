import { useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, Search, X } from "lucide-react";

import { EMPTY_LIBRARY_FILTERS, filterLibraryGames, getLibrarySearchFacets, LIBRARY_FEATURE_OPTIONS } from "./librarySearch";
import type { LibrarySearchFilters } from "./librarySearch";
import type { CatalogGame } from "./types";

export function LibrarySphere({ games, query, setQuery, searchFilters = EMPTY_LIBRARY_FILTERS, onSearchFiltersChange = () => undefined, onOpen, onClose, detailOpen = false }: {
  games: CatalogGame[];
  query: string;
  setQuery: (value: string) => void;
  searchFilters?: LibrarySearchFilters;
  onSearchFiltersChange?: (filters: LibrarySearchFilters) => void;
  onOpen: (game: CatalogGame) => void;
  onClose: () => void;
  detailOpen?: boolean;
}) {
  const [genreQuery, setGenreQuery] = useState("");
  const [featureQuery, setFeatureQuery] = useState("");
  const facets = useMemo(() => getLibrarySearchFacets(games), [games]);
  const visible = useMemo(() => filterLibraryGames(games, query, searchFilters), [games, query, searchFilters]);
  const toggleFilter = (group: "genres" | "features", value: string) => {
    const current = searchFilters[group] as string[];
    const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
    onSearchFiltersChange({ ...searchFilters, [group]: next } as LibrarySearchFilters);
  };
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const columns = 11;
  const selectedGame = visible[selectedIndex] ?? visible[0];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      const radius = Math.max(900, Math.min(1800, entry.contentRect.width * .72));
      root.style.setProperty("--dome-radius", `${Math.round(radius)}px`);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  useEffect(() => {
    if (!detailOpen) rootRef.current?.focus({ preventScroll: true });
  }, [detailOpen]);

  const moveSelection = (delta: number) => {
    setSelectedIndex((current) => Math.max(0, Math.min(visible.length - 1, current + delta)));
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (detailOpen) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key === "f") {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (event.target instanceof HTMLInputElement && key !== "escape") return;
    if (event.target instanceof HTMLElement && event.target.closest(".library-search-filter-dropdown") && key !== "escape") return;
    const moves: Record<string, number> = {arrowleft: -1, a: -1, arrowright: 1, d: 1, arrowup: -columns, w: -columns, arrowdown: columns, s: columns};
    if (moves[key] !== undefined) moveSelection(moves[key]);
    else if (key === "enter" && selectedGame) onOpen(selectedGame);
    else if (key === "escape") onClose();
    else return;
    event.preventDefault();
  };

  return (
    <div ref={rootRef} className={`library-vault dome-root ${detailOpen ? "has-detail" : ""}`} role="dialog" aria-modal="true" aria-label="Tu biblioteca completa" tabIndex={-1} onKeyDown={keyDown}>
      <div className="library-vault-head">
        <div><span className="eyebrow">BIBLIOTECA INMERSIVA</span><h2>{selectedGame?.name ?? "Tus juegos"}</h2><p>{visible.length} juegos en esta vista</p></div>
        <div className="library-vault-actions">
          <label className="library-search"><Search size={18} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en tu biblioteca" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={16} /></button> : null}</label>
          <div className="library-search-filters">
            <details className="library-search-filter-dropdown">
              <summary>Géneros{searchFilters.genres.length ? ` · ${searchFilters.genres.length}` : ""}</summary>
              <div className="library-search-filter-menu">
                <input type="search" value={genreQuery} onChange={event => setGenreQuery(event.target.value)} placeholder="Buscar género" aria-label="Buscar género" />
                <div className="library-search-filter-options">
                  {facets.genres.filter(value => value.toLocaleLowerCase("es").includes(genreQuery.trim().toLocaleLowerCase("es"))).map(value => <label key={value}><input type="checkbox" checked={searchFilters.genres.includes(value)} onChange={() => toggleFilter("genres", value)} />{value}</label>)}
                  {!facets.genres.length ? <p>No hay géneros disponibles.</p> : null}
                </div>
                {searchFilters.genres.length ? <button type="button" onClick={() => onSearchFiltersChange({ ...searchFilters, genres: [] })}>Limpiar géneros</button> : null}
              </div>
            </details>
            <details className="library-search-filter-dropdown">
              <summary>Funciones de Steam{searchFilters.features.length ? ` · ${searchFilters.features.length}` : ""}</summary>
              <div className="library-search-filter-menu">
                <input type="search" value={featureQuery} onChange={event => setFeatureQuery(event.target.value)} placeholder="Buscar función" aria-label="Buscar función de Steam" />
                <div className="library-search-filter-options">
                  {LIBRARY_FEATURE_OPTIONS.filter(option => facets.features.includes(option.key) && option.label.toLocaleLowerCase("es").includes(featureQuery.trim().toLocaleLowerCase("es"))).map(({ key, label }) => <label key={key}><input type="checkbox" checked={searchFilters.features.includes(key)} onChange={() => toggleFilter("features", key)} />{label}</label>)}
                  {!facets.features.length ? <p>No hay funciones de Steam disponibles.</p> : null}
                </div>
                {searchFilters.features.length ? <button type="button" onClick={() => onSearchFiltersChange({ ...searchFilters, features: [] })}>Limpiar funciones</button> : null}
              </div>
            </details>
          </div>
          <button type="button" className="library-close" onClick={onClose} aria-label="Cerrar biblioteca"><X size={20} /></button>
        </div>
      </div>
      <div className="dome-viewport">
        <div className="dome-stage"><div className="dome-sphere">
          {visible.map((game, index) => {
            const selectedRow = Math.floor(selectedIndex / columns);
            const selectedColumn = selectedIndex % columns;
            const row = Math.floor(index / columns);
            const column = index % columns;
            const offsetX = column - selectedColumn;
            const offsetY = row - selectedRow;
            const selected = index === selectedIndex;
            return <button type="button" className={`dome-cell ${selected ? "is-selected" : ""}`} key={game.id} style={{ "--dome-x": offsetX, "--dome-y": offsetY } as React.CSSProperties} onClick={() => setSelectedIndex(index)} onDoubleClick={() => onOpen(game)} aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}`} aria-current={selected ? "true" : undefined}>
              {game.capsule_image || game.header_image ? <img src={game.capsule_image ?? game.header_image ?? ""} alt="" draggable={false} /> : <span className="dome-cell-fallback"><Gamepad2 size={32} /></span>}<span>{game.name}</span>
            </button>;
          })}
        </div></div>
        <div className="dome-vignette" />
        {!visible.length ? <div className="library-empty">No encontramos juegos con “{query}”.</div> : null}
      </div>
      {selectedGame ? <div className="dome-selection-readout"><span>{selectedIndex + 1} / {visible.length}</span><strong>{selectedGame.name}</strong><small>ENTER · ABRIR FICHA</small></div> : null}
      <section  className="dome-controls-hint" aria-label="Controles de navegación">{detailOpen ? <><span>NAVEGAR ACCIONES · WASD / FLECHAS</span><span>ACTIVAR · ENTER</span><span>VOLVER · ESC</span></> : <><span>NAVEGAR · WASD / FLECHAS</span><span>VER DETALLES · ENTER</span><span>BUSCAR · CTRL+F</span><span>VOLVER · ESC</span></>}</section>
    </div>
  );
}

