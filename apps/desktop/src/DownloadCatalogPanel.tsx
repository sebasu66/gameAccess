import LibrarySectionShelf from "./LibrarySectionShelf";
import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { ArrowUpToLine, Loader2, Play } from "lucide-react";

import { downloadManager } from "./downloadManager";
import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { EMPTY_LIBRARY_FILTERS, LIBRARY_FEATURE_OPTIONS } from "./librarySearch";
import type { LibraryFeatureKey, LibrarySearchFacets, LibrarySearchFilters } from "./librarySearch";
import type { CatalogSort, LibrarySection, LibraryView } from "./librarySections";
import GameStorageContextMenu from "./GameStorageContextMenu";
import type { GameStorageContextMenuRequest } from "./GameStorageContextMenu";
import SteamCover from "./SteamCover";
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

interface DownloadGameCardProps {
  game: CatalogGame;
  index: number;
  selected: boolean;
  status?: ManagedDownloadStatus;
  pinned: boolean;
  onSelect: (index: number) => void;
  onContextMenu: (request: ContextMenuRequest) => void;
}

function DownloadGameCard({ game, index, selected, status, pinned, onSelect, onContextMenu }: DownloadGameCardProps) {
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
        aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}${game.genres?.[0] ? ` · género ${game.genres[0]}` : ""}${accessibilityState}`}
        tabIndex={-1}
      >
        <span className="library-room-card-art">
          <span className="library-room-card-cover-base"><SteamCover game={game} /></span>
          {active ? <span className="library-room-card-color-fill" aria-hidden="true"><SteamCover game={game} /></span> : null}
          {state.playButtonReady ? <StorageBadge /> : null}
          {active ? <span className="library-download-state"><Loader2 className={status?.state === "paused" ? "" : "spin"} size={12} /> {label}</span> : null}
          {game.genres?.[0] ? <span className="library-room-card-genre" aria-hidden="true">{game.genres[0]}</span> : null}
        </span>
      </button>
    </div>
  );
}

interface DownloadCatalogPanelProps {
  games: CatalogGame[];
  section?: LibrarySection;
  view?: LibraryView;
  onViewChange?: (view: LibraryView) => void;
  catalogSort?: CatalogSort;
  onCatalogSortChange?: (sort: CatalogSort) => void;
  facets?: LibrarySearchFacets;
  filters?: LibrarySearchFilters;
  onFiltersChange?: (filters: LibrarySearchFilters) => void;
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
  const onViewChange = props.onViewChange ?? (() => undefined);
  const catalogSort = props.catalogSort ?? "steam-popularity";
  const onCatalogSortChange = props.onCatalogSortChange ?? (() => undefined);
  const facets = props.facets ?? { genres: [], categories: [], features: [] };
  const filters = props.filters ?? EMPTY_LIBRARY_FILTERS;
  const onFiltersChange = props.onFiltersChange ?? (() => undefined);
  const [sectionReset, setSectionReset] = useState(0);
  const indexes = new Map(props.games.map((game, index) => [game.id, index]));
  const [contextMenu, setContextMenu] = useState<OpenContextMenu>(null);
  const views: { id: LibraryView; label: string }[] = [
    { id: "popular", label: "Populares" },
    { id: "installed", label: "Instalados" },
    { id: "favorites", label: "Favoritos" },
    { id: "categories", label: "Categorías" },
  ];
  const toggleOption = (group: "genres" | "categories" | "features", value: string) => {
    const current = filters[group] as string[];
    const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
    onFiltersChange({ ...filters, [group]: next } as LibrarySearchFilters);
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


  return (
    <section className="library-room-catalog">
      <header className="library-catalog-toolbar library-catalog-controls">
        <div className="library-catalog-tabs" role="tablist" aria-label="Colecciones de juegos">
          {views.map(item => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} className={view === item.id ? "is-active" : ""} onClick={() => { onViewChange(item.id); setSectionReset(value => value + 1); props.onSelect(0); props.gridRef.current?.scrollTo({ top: 0, behavior: "auto" }); }}>{item.label}</button>)}
        </div>
        <div className="library-catalog-actions">
          {view === "popular" || view === "categories" ? <label className="library-catalog-sort">Ordenar por <select value={catalogSort} onChange={event => onCatalogSortChange(event.target.value as CatalogSort)}><option value="steam-popularity">Recomendaciones globales de Steam</option><option value="gameaccess-demand">Solicitudes en GameAccess</option><option value="name">Nombre A–Z</option></select></label> : null}
          <small>{props.games.length} juegos</small>
          <button type="button" onClick={() => { setSectionReset(value => value + 1); props.onSelect(0); props.gridRef.current?.scrollTo({ top: 0, behavior: "auto" }); }}><ArrowUpToLine size={15} /> Volver al inicio</button>
        </div>
      </header>
      {view === "categories" ? <details className="library-catalog-filters" open>
        <summary>Filtrar por metadatos</summary>
        <div className="library-catalog-filter-groups">
        <fieldset><legend>Géneros</legend>{facets.genres.map(value => <label key={value}><input type="checkbox" checked={filters.genres.includes(value)} onChange={() => toggleOption("genres", value)} />{value}</label>)}</fieldset>
        <fieldset><legend>Categorías de Steam</legend>{facets.categories.map(value => <label key={value}><input type="checkbox" checked={filters.categories.includes(value)} onChange={() => toggleOption("categories", value)} />{value}</label>)}</fieldset>
        <fieldset><legend>Funciones</legend>{LIBRARY_FEATURE_OPTIONS.filter(option => facets.features.includes(option.key)).map(({ key, label }) => <label key={key}><input type="checkbox" checked={filters.features.includes(key)} onChange={() => toggleOption("features", key)} />{label}</label>)}</fieldset>
        {filters.genres.length + filters.categories.length + filters.features.length > 0 ? <button type="button" onClick={() => onFiltersChange(EMPTY_LIBRARY_FILTERS)}>Limpiar filtros</button> : null}
        </div>
      </details> : null}
      <div ref={props.gridRef} className="library-room-grid library-section-scroll">
        <LibrarySectionShelf section={section} selectedId={props.games[props.selectedIndex]?.id} reset={sectionReset} renderGame={game => <DownloadGameCard key={game.id} game={game} index={indexes.get(game.id)!} selected={game.id === props.games[props.selectedIndex]?.id} status={game.app_id ? props.downloads[game.app_id] : undefined} pinned={Boolean(game.app_id && props.pinnedAppIds.has(game.app_id))} onSelect={props.onSelect} onContextMenu={setContextMenu} />} />
      </div>
      {contextMenu ? <GameStorageContextMenu request={contextMenu} onClose={() => setContextMenu(null)} onInstall={props.onInstall} onPlay={props.onPlay} /> : null}
    </section>
  );
}
