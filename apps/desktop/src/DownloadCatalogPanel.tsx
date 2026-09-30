import { createPortal } from "react-dom";
import LibrarySectionShelf from "./LibrarySectionShelf";
import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { ArrowUpDown, ArrowUpToLine, Loader2, Play, Star } from "lucide-react";

import { downloadManager } from "./downloadManager";
import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogSort, LibrarySection, LibraryView } from "./librarySections";
import { getLibrarySearchFacets, LIBRARY_FEATURE_OPTIONS } from "./librarySearch";
import type { LibrarySearchFilters } from "./librarySearch";
import GameStorageContextMenu from "./GameStorageContextMenu";
import type { GameStorageContextMenuRequest } from "./GameStorageContextMenu";
import SteamCover from "./SteamCover";
import SteamGlobalSearch from "./SteamGlobalSearch";
import { calculateSelectionScrollTop, selectionItemTopInScrollContainer } from "./libraryNavigation";
import type { DownloadMap } from "./LibraryRoomParts";
import type { CatalogGame } from "./types";

function StorageBadge() {
  return <span className="library-install-state ready" title="Listo para presionar Jugar"><Play size={12} fill="currentColor" /></span>;
}

function statusLabel(status: ManagedDownloadStatus | undefined, progress: number) {
  switch (status?.state) {
    case "requested": return "Pendiente";
    case "preparing": return "Preparando";
    case "paused": return "Pausado";
    case "cancelling": return "Cancelando";
    case "interrupted": return "Interrumpida";
    default: return `${Math.round(progress)}%`;
  }
}

function cardClass(selected: boolean, active: boolean, pinned: boolean) {
  return [
    "library-room-card",
    selected ? "is-selected" : "",
    active ? "is-download-active" : "",
    pinned ? "is-download-pinned" : "",
  ].filter(Boolean).join(" ");
}

type ContextMenuRequest = GameStorageContextMenuRequest;

function LibraryFacetFilter({ title, options, selected, onToggle, onClear }: {
  title: string;
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  return <details className="library-toolbar-filter">
    <summary>{title}{selected.length ? ` · ${selected.length}` : ""}</summary>
    <div className="library-toolbar-filter-menu">
      <div className="library-toolbar-filter-options">
        {options.map(option => <label key={option.id}><input type="checkbox" checked={selected.includes(option.id)} onChange={() => onToggle(option.id)} />{option.label}</label>)}
        {!options.length ? <p>No hay opciones disponibles.</p> : null}
      </div>
      {selected.length ? <button type="button" onClick={onClear}>Limpiar {title.toLocaleLowerCase("es")}</button> : null}
    </div>
  </details>;
}

interface DownloadGameCardProps {
  game: CatalogGame;
  index: number;
  selected: boolean;
  status?: ManagedDownloadStatus;
  pinned: boolean;
  onSelect: (index: number) => void;
  onContextMenu: (request: ContextMenuRequest) => void;
  favorite: boolean;
}

function DownloadGameCard({ game, index, selected, status, pinned, favorite, onSelect, onContextMenu }: DownloadGameCardProps) {
  const state = gameStateManager.resolve(status);
  const active = state.transferActive;
  const progress = downloadManager.progress(status);
  const label = statusLabel(status, progress);
  const style = { "--download-progress": `${progress}%` } as CSSProperties;
  const accessibilityState = active
    ? ` · descarga ${label}`
    : state.playButtonReady
      ? " · listo para Jugar"
      : "";
  const favoriteLabel = favorite ? " · favorito" : "";

  const showContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onSelect(index);
    onContextMenu({ game, x: event.clientX, y: event.clientY, status });
  };

  return (
    <div className="library-room-card-shell">
      <button
        type="button"
        className={cardClass(selected, active, pinned)}
        style={style}
        data-library-game-id={game.id}
        data-install-folder-available={state.canOpenInstallFolder ? "true" : "false"}
        onClick={() => onSelect(index)}
        onContextMenu={showContextMenu}
        aria-current={selected ? "true" : undefined}
        aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}${game.genres?.[0] ? ` · género ${game.genres[0]}` : ""}${accessibilityState}${favoriteLabel}`}
        tabIndex={-1}
      >
        <span className="library-room-card-art">
          <span className="library-room-card-cover-base"><SteamCover game={game} /></span>
          {active ? <span className="library-room-card-color-fill" aria-hidden="true"><SteamCover game={game} /></span> : null}
          {state.playButtonReady ? <StorageBadge /> : null}
          {favorite ? <span className="library-favorite-state" title="Favorito" aria-label="Favorito"><Star size={13} fill="currentColor" /></span> : null}
          {active ? <span className="library-download-state"><Loader2 className={status?.state === "paused" ? "" : "spin"} size={12} /> {label}</span> : null}
          {game.genres?.[0] ? <span className="library-room-card-genre" aria-hidden="true">{game.genres[0]}</span> : null}
        </span>
      </button>
    </div>
  );
}

interface DownloadCatalogPanelProps {
  toolbarTarget?: HTMLDivElement | null;
  actionsTarget?: HTMLDivElement | null;
  games: CatalogGame[];
  section?: LibrarySection;
  view?: LibraryView;
  onViewChange?: (view: LibraryView) => void;
  catalogSort?: CatalogSort;
  onCatalogSortChange?: (sort: CatalogSort) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  allGames?: CatalogGame[];
  searchFilters?: LibrarySearchFilters;
  onSearchFiltersChange?: (filters: LibrarySearchFilters) => void;
  hasInstalled?: boolean;
  hasFavorites?: boolean;
  catalogUnavailable?: boolean;
  downloads: DownloadMap;
  accountCount: number;
  selectedIndex: number;
  gridRef: RefObject<HTMLDivElement>;
  pinnedAppIds: Set<number>;
  onSelect: (index: number) => void;
  preferences?: Record<number, 1 | -1>;
  history?: Record<number, number>;
  onPlay?: (game: CatalogGame) => void | Promise<void>;
  onInstall?: (game: CatalogGame) => void | Promise<void>;
}

type OpenContextMenu = ContextMenuRequest | null;

export default function DownloadCatalogPanel(props: DownloadCatalogPanelProps) {
  const section = props.section ?? { id: "catalog" as const, title: "Catálogo", games: props.games };
  const view = props.view ?? "catalog";
  const displaySection = props.catalogUnavailable && view === "catalog"
    ? { ...section, emptyMessage: "En este momento no pudimos conectarnos con el servicio de GameAccess para recuperar la lista de juegos." }
    : section;
  const onViewChange = props.onViewChange ?? (() => undefined);
  const catalogSort = props.catalogSort ?? "steam-popularity";
  const onCatalogSortChange = props.onCatalogSortChange ?? (() => undefined);
  const searchQuery = props.searchQuery ?? "";
  const onSearchQueryChange = props.onSearchQueryChange ?? (() => undefined);
  const allGames = props.allGames ?? props.games;
  const searchFilters = props.searchFilters ?? { genres: [], categories: [], features: [] };
  const onSearchFiltersChange = props.onSearchFiltersChange ?? (() => undefined);
  const [sectionReset, setSectionReset] = useState(0);
  const indexes = new Map(props.games.map((game, index) => [game.id, index]));
  const [contextMenu, setContextMenu] = useState<OpenContextMenu>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const facets = getLibrarySearchFacets(allGames);
  const toggleFilter = (group: "genres" | "features", value: string) => {
    const current = searchFilters[group] as string[];
    const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
    onSearchFiltersChange({ ...searchFilters, [group]: next } as LibrarySearchFilters);
  };
  const views: { id: LibraryView; label: string }[] = [
    { id: "catalog", label: "Catálogo" },
    ...(props.hasInstalled ? [{ id: "installed" as const, label: "Instalados" }] : []),
    ...(props.hasFavorites ? [{ id: "favorites" as const, label: "Favoritos" }] : []),
  ];
  const sortOptions: { id: CatalogSort; label: string }[] = [
    { id: "release-date", label: "Fecha de lanzamiento" },
    { id: "steam-popularity", label: "Popularidad en Steam" },
    { id: "steam-review-score", label: "Puntuación de reseñas" },
    { id: "name", label: "Nombre A–Z" },
  ];
  const selectedSortLabel = sortOptions.find(option => option.id === catalogSort)?.label ?? "Ordenar";

  useEffect(() => {
    const grid = props.gridRef.current;
    const room = grid?.closest<HTMLElement>(".library-room");
    if (!grid) return;
    const updateVisibility = () => setShowBackToTop(grid.scrollTop > 320 || (room?.scrollTop ?? 0) > 320 || window.scrollY > 320);
    grid.addEventListener("scroll", updateVisibility, { passive: true });
    room?.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("scroll", updateVisibility, { passive: true, capture: true });
    updateVisibility();
    return () => {
      grid.removeEventListener("scroll", updateVisibility);
      room?.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("scroll", updateVisibility, true);
    };
  }, [props.gridRef]);

  const returnToTop = () => {
    props.gridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    props.gridRef.current?.closest<HTMLElement>(".library-room")?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    const grid = props.gridRef.current;
    const card = grid?.querySelector<HTMLElement>(".library-room-card.is-selected");
    if (!grid || !card || props.selectedIndex < 0) return;
    const gridRect = grid.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const itemTop = selectionItemTopInScrollContainer({
      scrollTop: grid.scrollTop,
      viewportTop: gridRect.top,
      itemTop: cardRect.top,
    });
    const nextTop = calculateSelectionScrollTop({
      scrollTop: grid.scrollTop,
      viewportHeight: grid.clientHeight,
      itemTop,
      itemHeight: cardRect.height,
      padding: 8,
    });
    if (Math.abs(nextTop - grid.scrollTop) > 1) grid.scrollTo({ top: nextTop, behavior: "auto" });
  }, [props.gridRef, props.selectedIndex]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", keydown);
    };
  }, [contextMenu]);


  const toolbar = (
      <div className="library-catalog-toolbar library-catalog-controls">
        <div className="library-catalog-tabs" role="tablist" aria-label="Colecciones de juegos">
          {views.map(item => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} className={`tab-${item.id}${view === item.id ? " is-active" : ""}`} onClick={() => { onViewChange(item.id); setSectionReset(value => value + 1); props.onSelect(0); props.gridRef.current?.scrollTo({ top: 0, behavior: "auto" }); }}>{item.label}</button>)}
          </div>
        <SteamGlobalSearch query={searchQuery} setQuery={onSearchQueryChange} />
        <div className="library-catalog-filter-actions">
        <LibraryFacetFilter title="Géneros" options={facets.genres.map(value => ({ id: value, label: value }))} selected={searchFilters.genres} onToggle={value => toggleFilter("genres", value)} onClear={() => onSearchFiltersChange({ ...searchFilters, genres: [] })} />
        <LibraryFacetFilter title="Modo de juego" options={LIBRARY_FEATURE_OPTIONS.filter(option => facets.features.includes(option.key)).map(option => ({ id: option.key, label: option.label }))} selected={searchFilters.features} onToggle={value => toggleFilter("features", value)} onClear={() => onSearchFiltersChange({ ...searchFilters, features: [] })} />
        {view === "catalog" ? <details className="library-sort-dropdown">
          <summary aria-label={`Ordenar por ${selectedSortLabel}`} title={`Ordenar por: ${selectedSortLabel}`}><ArrowUpDown size={17} /><span>{selectedSortLabel}</span></summary>
          <div className="library-sort-menu" role="group" aria-label="Criterio de orden">
            {sortOptions.map(option => <button key={option.id} type="button" aria-pressed={catalogSort === option.id} onClick={event => { onCatalogSortChange(option.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{option.label}</button>)}
          </div>
        </details> : null}
        </div>
      </div>
  );
  const backToTop = showBackToTop ? <button type="button" className="library-back-to-top" onClick={returnToTop} aria-label="Volver arriba" title="Volver arriba"><ArrowUpToLine size={17} /><span>Volver arriba</span></button> : null;

  return (
    <section className="library-room-catalog">
      {props.toolbarTarget ? createPortal(toolbar, props.toolbarTarget) : toolbar}
      <div ref={props.gridRef} className="library-room-grid library-section-scroll">
        <LibrarySectionShelf section={displaySection} selectedId={props.games[props.selectedIndex]?.id} reset={sectionReset} scrollRoot={props.gridRef} renderGame={game => <DownloadGameCard key={game.id} game={game} index={indexes.get(game.id)!} selected={game.id === props.games[props.selectedIndex]?.id} status={game.app_id ? props.downloads[game.app_id] : undefined} pinned={Boolean(game.app_id && props.pinnedAppIds.has(game.app_id))} favorite={props.preferences?.[game.id] === 1} onSelect={props.onSelect} onContextMenu={setContextMenu} />} />
      </div>
      {props.actionsTarget ? createPortal(backToTop, props.actionsTarget) : null}
      {contextMenu ? <GameStorageContextMenu request={contextMenu} onClose={() => setContextMenu(null)} onInstall={props.onInstall} onPlay={props.onPlay} /> : null}
    </section>
  );
}
