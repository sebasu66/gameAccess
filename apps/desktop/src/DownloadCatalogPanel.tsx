import FilledIcon from "./FilledIcon";
import { loadOverviewZoom, normalizeOverviewZoom, overviewCoverSizing, saveOverviewZoom } from "./overviewSizing";
import { useI18n } from "./i18n";
import CircularScrollbar from "./CircularScrollbar";
import LibraryFilterDialog, { activeFilterTags } from "./LibraryFilterDialog";
import { createPortal } from "react-dom";
import LibrarySectionShelf from "./LibrarySectionShelf";
import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { ArrowUpDown, ArrowUpToLine, Loader2, Star, X } from "lucide-react";

import { downloadManager } from "./downloadManager";
import { gameStateManager } from "./GameStateManager";
import { getDownloadStatusLabel } from "./GenericDownloadProgress";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogSort, LibrarySection, LibraryView } from "./librarySections";
import { getLibrarySearchFacets, LIBRARY_FEATURE_OPTIONS } from "./librarySearch";
import type { LibrarySearchFilters } from "./librarySearch";
import { getCatalogMode } from "./catalogMode";
import DigitalGameContextMenu from "./DigitalGameContextMenu";
import GameStorageContextMenu from "./GameStorageContextMenu";
import type { GameStorageContextMenuRequest } from "./GameStorageContextMenu";
import SteamCover from "./SteamCover";
import SteamGlobalSearch from "./SteamGlobalSearch";
import type { DownloadMap } from "./LibraryRoomParts";
import type { CatalogGame } from "./types";

function StorageBadge() {
  return <span className="library-install-state ready" title="Listo para presionar Jugar"><span aria-hidden="true">✓</span> INSTALADO</span>;
}

function statusLabel(status: ManagedDownloadStatus | undefined, progress: number) {
  return getDownloadStatusLabel(status, progress);
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


interface DownloadGameCardProps {
  game: CatalogGame;
  index: number;
  selected: boolean;
  status?: ManagedDownloadStatus;
  pinned: boolean;
  onSelect: (index: number, openDetails?: boolean) => void;
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
  const favoriteLabel = (favorite ? " · favorito" : "") + (game.filter_match === "possible" ? " · coincidencia posible, datos incompletos" : "");

  const showContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onSelect(index, false);
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
        onFocus={() => onSelect(index, false)}
        onClick={() => onSelect(index)}
        onContextMenu={showContextMenu}
        aria-current={selected ? "true" : undefined}
        aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}${game.genres?.[0] ? ` · género ${game.genres[0]}` : ""}${accessibilityState}${favoriteLabel}`}
        tabIndex={-1}
      >
        <span className="library-room-card-art">
          <span className="library-room-card-cover-base">{game.filter_match === "possible" ? <span className="ga-possible-match" title="Steam no confirma todos los criterios seleccionados">Datos incompletos</span> : null}
        <SteamCover game={game} /></span>
          {active && progress > 0 ? <span className="library-room-card-color-fill" aria-hidden="true"><SteamCover game={game} /></span> : null}
          {state.playButtonReady ? <StorageBadge /> : null}
          {favorite ? <span className="library-favorite-state" title="Favorito" aria-label="Favorito"><Star size={13} fill="currentColor" /></span> : null}
          {active ? <span className="library-download-state"><Loader2 className={status?.state === "paused" ? "" : "spin"} size={12} /> {label}</span> : null}
          {game.genres?.[0] ? <span className="library-room-card-genre" aria-hidden="true">{game.genres[0]}</span> : null}
        </span>
      </button>
      <div className="ga-card-caption"><span>{game.name}</span><small>{game.release_date?.match(/\d{4}/)?.[0]}</small></div>
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
  onSelect: (index: number, openDetails?: boolean) => void;
  preferences?: Record<number, 1 | -1>;
  history?: Record<number, number>;
  onPlay?: (game: CatalogGame) => void | Promise<void>;
  onInstall?: (game: CatalogGame) => void | Promise<void>;
}

type OpenContextMenu = ContextMenuRequest | null;

export default function DownloadCatalogPanel(props: DownloadCatalogPanelProps) {
  const { locale } = useI18n();
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [gridZoom, setGridZoom] = useState(loadOverviewZoom);
  const [sectionReset, setSectionReset] = useState(0);
  const indexes = new Map(props.games.map((game, index) => [game.id, index]));
  const [contextMenu, setContextMenu] = useState<OpenContextMenu>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  const facets = getLibrarySearchFacets(allGames);
  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const availableWidth = Math.max(120, (props.gridRef.current?.clientWidth ?? viewport.width * .92) - 26);
  const { coverFloor, coverColumns } = overviewCoverSizing(viewport.width, viewport.height, availableWidth, displaySection.games.length, gridZoom);
  const updateZoom = (value: number) => { const next = normalizeOverviewZoom(value); setGridZoom(next); saveOverviewZoom(next); };
  const toggleFilter = (group: "genres" | "features" | "sources", value: string) => {
    const current = (searchFilters[group] ?? []) as string[];
    const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
    onSearchFiltersChange({ ...searchFilters, [group]: next } as LibrarySearchFilters);
  };
  const views: { id: LibraryView; label: string }[] = [
    { id: "catalog", label: "Catálogo" },
    { id: getCatalogMode() === "digital" ? "library" : "installed", label: "Biblioteca" },
  ];
  const sortOptions: { id: CatalogSort; label: string }[] = [
    { id: "release-date", label: "Fecha de lanzamiento" },
    { id: "steam-popularity", label: "Popularidad" },
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
    if (!contextMenu) return;
    const close = (event?: Event) => {
      if (event?.target instanceof Element && event.target.closest(".ga-digital-menu-root")) return;
      setContextMenu(null);
    };
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
      <>
      
      <div className="library-catalog-toolbar library-catalog-controls">
        <div className="ga-search-dock"><SteamGlobalSearch query={searchQuery} setQuery={onSearchQueryChange} />
          <div className="ga-search-meta"><output className="ga-search-results" aria-live="polite">{displaySection.games.length} {locale === "es" ? "juegos" : "games"} / {displaySection.games.filter(game => props.preferences?.[game.id] === 1).length} {locale === "es" ? "favoritos" : "favorites"}</output>
          <label className="ga-grid-zoom"><span>Zoom</span><input type="range" min="100" max="160" step="5" value={gridZoom} onChange={event => updateZoom(Number(event.target.value))} aria-label={locale === "es" ? "Zoom de las portadas" : "Cover zoom"} aria-valuetext={`${gridZoom}%`} /><output>{gridZoom}%</output></label></div></div>
        <div className="library-catalog-tabs" role="tablist" aria-label="Colecciones de juegos">
          {views.map(item => <button key={item.id} type="button" role="tab" aria-label={item.label} aria-selected={view === item.id || (item.id === "installed" && view === "favorites")} className={`tab-${item.id}${view === item.id || (item.id === "installed" && view === "favorites") ? " is-active" : ""}`} onClick={() => { onViewChange(item.id); setSectionReset(value => value + 1); props.onSelect(0, false); props.gridRef.current?.scrollTo({ top: 0, behavior: "auto" }); }}>{item.id === "catalog" ? <FilledIcon name="catalog" /> : <FilledIcon name="library" />}<span>{item.label}</span></button>)}
          </div>


      </div>
      </>
  );
  const filters = (
        <div className="library-catalog-filter-actions">
        <button type="button" className="ga-filter-open" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}><FilledIcon name="genres" />Filtros{activeFilterTags(searchFilters).length ? ` · ${activeFilterTags(searchFilters).length}` : ""}</button>
        <div className="ga-filter-tags" aria-label="Filtros activos">{activeFilterTags(searchFilters).length ? activeFilterTags(searchFilters).map(tag => <span key={`${tag.group}:${tag.value}`} className="ga-filter-tag"><button type="button" onClick={() => setFiltersOpen(true)}>{tag.label}</button><button type="button" aria-label={`Quitar filtro ${tag.label}`} onClick={() => toggleFilter(tag.group, tag.value)}><X size={13} /></button></span>) : <span className="ga-filter-any">Todos</span>}</div>
        <span className="ga-footer-divider" aria-hidden="true" />
        {<details className="library-sort-dropdown">
          <summary aria-label={`Ordenar por ${selectedSortLabel}`} title={`Ordenar por: ${selectedSortLabel}`}><ArrowUpDown size={17} /><span>{selectedSortLabel}</span></summary>
          <div className="library-sort-menu" role="group" aria-label="Criterio de orden">
            {sortOptions.map(option => <button key={option.id} type="button" aria-pressed={catalogSort === option.id} onClick={event => { onCatalogSortChange(option.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{option.label}</button>)}
          </div>
        </details>}
        </div>
  );
  const backToTop = showBackToTop ? <button type="button" className="library-back-to-top" onClick={returnToTop} aria-label="Volver arriba" title="Volver arriba"><ArrowUpToLine size={17} /><span>Volver arriba</span></button> : null;

  return (
    <section className="library-room-catalog">
      {filtersOpen ? <LibraryFilterDialog games={view === "installed" ? allGames.filter(game => { const status = game.app_id ? props.downloads[game.app_id] : undefined; const state = gameStateManager.resolve(status); return state.installed || state.prepared || props.preferences?.[game.id] === 1; }) : allGames} query={searchQuery} filters={searchFilters} genres={facets.genres} onApply={next => { onSearchFiltersChange(next); setFiltersOpen(false); setSectionReset(value => value + 1); props.gridRef.current?.scrollTo({ top: 0, behavior: "auto" }); }} /> : null}
      {props.toolbarTarget ? createPortal(toolbar, props.toolbarTarget) : toolbar}
      <div className="ga-scroll-frame">
      <div ref={props.gridRef} className="library-room-grid library-section-scroll" data-cover-zoom={gridZoom} data-cover-columns={coverColumns} style={{ "--ga-cover-floor": `${coverFloor}px`, "--ga-cover-columns": coverColumns } as CSSProperties}>
        <LibrarySectionShelf section={displaySection} selectedId={props.games[props.selectedIndex]?.id} reset={sectionReset} scrollRoot={props.gridRef} renderGame={game => <DownloadGameCard key={game.id} game={game} index={indexes.get(game.id)!} selected={game.id === props.games[props.selectedIndex]?.id} status={(game.app_id ? props.downloads[game.app_id] : undefined) ?? props.downloads[game.id]} pinned={Boolean(game.app_id && props.pinnedAppIds.has(game.app_id))} favorite={props.preferences?.[game.id] === 1} onSelect={props.onSelect} onContextMenu={setContextMenu} />} />
      </div>
      {typeof window !== "undefined" && !["tablet", "display"].includes(new URLSearchParams(window.location.search).get("surface") || "") ? <CircularScrollbar targetRef={props.gridRef} label="Desplazar juegos" /> : null}
      </div>
      {props.actionsTarget ? createPortal(<>{filters}{backToTop}</>, props.actionsTarget) : filters}
      {contextMenu ? (
        !((contextMenu.game as any).use_game_access === true || (contextMenu.game as any).is_game_access === true) ? (
          <DigitalGameContextMenu request={contextMenu} onClose={() => setContextMenu(null)} onInstall={props.onInstall} onPlay={props.onPlay} />
        ) : (
          <GameStorageContextMenu request={contextMenu} onClose={() => setContextMenu(null)} onInstall={props.onInstall} onPlay={props.onPlay} />
        )
      ) : null}
    </section>
  );
}
