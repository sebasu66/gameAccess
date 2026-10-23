import FilledIcon from "./FilledIcon";
import { useCatalogGenreNames } from "./catalogFilterParams";
import { overviewCoverSizing } from "./overviewSizing";
import "./catalog-dock.css";
import { useCardHover } from "./motion/cardHover";
import { setCoverCardWidth } from "./coverSize";
import { useI18n } from "./i18n";
import CircularScrollbar from "./CircularScrollbar";
import LibraryFilterDialog from "./LibraryFilterDialog";
import CatalogFilterToolbar from "./CatalogFilterToolbar";
import { createPortal } from "react-dom";
import LibrarySectionShelf from "./LibrarySectionShelf";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { ArrowUpDown, ArrowUpToLine, HardDrive, Loader2, Play, Snowflake, Star, X } from "lucide-react";

import { downloadManager } from "./downloadManager";
import { gameStateManager } from "./GameStateManager";
import { formatBytes, getDownloadStatusLabel } from "./GenericDownloadProgress";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogSort, LibrarySection, LibraryView } from "./librarySections";
import { genreConceptIds, genreIsSoftware, genreLabel } from "./libraryGenres";
import { DEFAULT_LIBRARY_FILTERS, filterLibraryGamesDetailed, getLibrarySearchFacets, hasNoActiveFilters, LIBRARY_FEATURE_OPTIONS, SOFTWARE_GENRES } from "./librarySearch";
import type { LibrarySearchFilters } from "./librarySearch";
import { getCatalogMode } from "./catalogMode";
import DigitalGameContextMenu from "./DigitalGameContextMenu";
import GameLibraryManager from "./library-manager/GameLibraryManager";
import DeskPanel from "./desk/DeskPanel";
import { closePanel, openPanel, togglePanel, useDesk } from "./desk/desk";
import { useLibraryEntry, useLibraryFlag } from "./libraryScan";
import GameStorageContextMenu from "./GameStorageContextMenu";
import type { GameStorageContextMenuRequest } from "./GameStorageContextMenu";
import SteamCover from "./SteamCover";
import SteamGlobalSearch from "./SteamGlobalSearch";
import type { DownloadMap } from "./LibraryRoomParts";
import type { CatalogGame } from "./types";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import { GaIconButton } from "./components/ga/Buttons";
import CatalogSpotlight from "./CatalogSpotlight";
import LibraryBento, { type LibraryPill } from "./LibraryBento";

/** Small play mark in the card footer: the game is installed and ready to launch. */
function InstalledMark() {
  const { t } = useI18n();
  return <span className="ga-card-installed" title={t("uiInstaladoListoParaJugar")} role="img" aria-label={t("uiInstaladoListoParaJugar2")}><Play size={11} fill="currentColor" /></span>;
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

/** A frozen game: a snowflake, what it takes on disk now and, faded, its real size. */
function FrozenSize({ entry }: { entry: LibraryGame }) {
  const { t } = useI18n();
  const stored = formatBytes(entry.frozen_bytes ?? null), original = formatBytes(entry.original_bytes ?? entry.size_bytes ?? null);
  const title = t(entry.frozen === "deep" ? "cardDeepFrozen" : "cardFrozen", { stored, original });
  return <div className={"ga-card-frozen" + (entry.frozen === "deep" ? " is-deep" : "")} title={title} role="img" aria-label={title}>
    <Snowflake size={12} aria-hidden="true" /><b>{stored}</b><span>{original}</span>
  </div>;
}

const DownloadGameCard = memo(function DownloadGameCard({ game, index, selected, status, pinned, favorite, onSelect, onContextMenu }: DownloadGameCardProps) {
  const { t, locale } = useI18n();
  const state = gameStateManager.resolve(status);
  const flag = useLibraryFlag(game.app_id ?? undefined);
  const entry = useLibraryEntry(game.app_id ?? undefined);
  const active = state.transferActive;
  const progress = downloadManager.progress(status);
  const label = statusLabel(status, progress);
  const style = { "--download-progress": `${progress}%` } as CSSProperties;
  const accessibilityState = active
    ? t("cardAriaDownloading", { label })
    : state.playButtonReady
      ? t("cardAriaReady")
      : "";
  const favoriteLabel = (favorite ? t("cardAriaFavorite") : "");
  // Raw catalog genres carry duplicates and content labels; show the canonical one.
  const cardGenreId = genreConceptIds(game.genres)[0];
  const cardGenre = cardGenreId ? genreLabel(cardGenreId) : undefined;

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
        aria-label={`${t(selected ? "selectedGameAria" : "selectGameAria", { name: game.name })}${cardGenre ? t("cardAriaGenre", { genre: cardGenre }) : ""}${accessibilityState}${favoriteLabel}`}
        tabIndex={-1}
      >
        <span className="library-room-card-art">
          <span className="library-room-card-cover-base">
        <SteamCover game={game} /></span>
          {active && progress > 0 ? <span className="library-room-card-color-fill" aria-hidden="true"><SteamCover game={game} /></span> : null}
          {favorite ? <span className="library-favorite-state" title={t("uiFavorito")} aria-label={t("uiFavorito")}><Star size={13} fill="currentColor" /></span> : null}
          {active ? <span className="library-download-state"><Loader2 className={status?.state === "paused" ? "" : "spin"} size={12} /> {label}</span> : null}
          {cardGenre ? <span className="library-room-card-genre" aria-hidden="true">{cardGenre}</span> : null}
          {state.playButtonReady ? <InstalledMark /> : null}
        </span>
      </button>
      <div className="ga-card-caption"><span>{game.name}</span>{game.release_date?.match(/\d{4}/)?.[0] ? <small>{game.release_date.match(/\d{4}/)![0]}</small> : null}</div>
      {/* Two downloads of one game can be different versions that cannot play online together: show which one this is. */}
      {/* The player's own name for it, or else the version as its download source names it ("SteamRIP · Game v1.2 - Repack"). */}
      {entry && (entry.label || entry.source_title) ? <div className="ga-card-source" title={entry.label ? t("cardLabelHint", { name: game.name }) : t("cardSourceHint", { provider: entry.source_provider || t("cardSourceUnknown"), title: entry.source_title ?? "" })}>
        {entry.label || [entry.source_provider, entry.source_title].filter(Boolean).join(" · ")}</div> : null}
      {entry?.frozen ? <FrozenSize entry={entry} /> : null}
      {flag ? <div className="ga-card-flag" title={flag.warning}>⚠ {flag.issues.some(issue => issue.code === "error") ? (locale === "en" ? "Has an error: needs processing" : "Con error: hay que procesarlo") : (locale === "en" ? "Outside the standard: needs processing" : "Fuera de estándar: hay que procesarlo")}</div> : null}
    </div>
  );
});

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
  catalogTotal?: number;
  catalogLoading?: boolean;
  downloads: DownloadMap;
  selectedIndex: number;
  gridRef: RefObject<HTMLDivElement>;
  pinnedAppIds: Set<number>;
  onSelect: (index: number, openDetails?: boolean) => void;
  preferences?: Record<number, 1 | -1>;
  history?: Record<number, number>;
  onPlay?: (game: CatalogGame) => void | Promise<void>;
  onInstall?: (game: CatalogGame) => void | Promise<void>;
  /** Installed games the catalog leaves out while there is no search (they are in the library). */
  hiddenInstalled?: number;
  isInstalled?: (game: CatalogGame) => boolean;
}

type OpenContextMenu = ContextMenuRequest | null;

export default function DownloadCatalogPanel(props: DownloadCatalogPanelProps) {
  const { t } = useI18n();
  const { locale } = useI18n();
  const section = props.section ?? { id: "catalog" as const, title: t("tabCatalog"), games: props.games, total: props.catalogTotal };
  const view = props.view ?? "catalog";
  const displaySection = props.catalogUnavailable && view === "catalog"
    ? { ...section, total: props.catalogTotal ?? section.total, emptyMessage: t("catalogUnavailable") }
    : { ...section, total: props.catalogTotal ?? section.total };
  const onViewChange = props.onViewChange ?? (() => undefined);
  const catalogSort = props.catalogSort ?? "steam-popularity";
  const onCatalogSortChange = props.onCatalogSortChange ?? (() => undefined);
  const searchQuery = props.searchQuery ?? "";
  const onSearchQueryChange = props.onSearchQueryChange ?? (() => undefined);
  const allGames = props.allGames ?? props.games;
  const searchFilters = props.searchFilters ?? { genres: [], categories: [], features: [] };
  const onSearchFiltersChange = props.onSearchFiltersChange ?? (() => undefined);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const managerOpen = useDesk().includes("manager");
  const [managerFocus, setManagerFocus] = useState<number | null>(null);
  useCardHover(props.gridRef);
  const [libraryPill, setLibraryPill] = useState<LibraryPill>("all");
  const [sectionReset, setSectionReset] = useState(0);
  // Keyed on the list itself: the catalog query is capped at 1000 rows, so a new search often has the same
  // count and first game, and a stale map gave clicked cards no index (the grid jumped, no detail opened).
  const indexes = useMemo(() => new Map(props.games.map((game, index) => [game.id, index])), [props.games]);
  const [contextMenu, setContextMenu] = useState<OpenContextMenu>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  const memoryFacets = useMemo(() => getLibrarySearchFacets(allGames), [allGames.length, allGames[0]?.id]);
  // The catalog offers every genre in the database, not only those of the games loaded in memory.
  const catalogGenreNames = useCatalogGenreNames();
  const facets = useMemo(() => {
    if (view === "installed" || !catalogGenreNames.length) return memoryFacets;
    const softwareIds = new Set(genreConceptIds(SOFTWARE_GENRES));
    const concepts = [...new Set(genreConceptIds(catalogGenreNames))].filter(id => !genreIsSoftware(id) && !softwareIds.has(id));
    return { ...memoryFacets, genres: concepts.sort((left, right) => genreLabel(left).localeCompare(genreLabel(right), "es")) };
  }, [memoryFacets, catalogGenreNames, view]);
  const favoritesCount = useMemo(() => displaySection.games.filter(game => props.preferences?.[game.id] === 1).length, [displaySection.games, props.preferences]);
  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const availableWidth = Math.max(120, (props.gridRef.current?.clientWidth ?? viewport.width * .92) - 26);
  const { coverFloor, coverColumns } = overviewCoverSizing(viewport.width, viewport.height, availableWidth, displaySection.games.length);
  setCoverCardWidth(coverFloor);
  const views: { id: LibraryView; label: string }[] = [
    { id: "catalog", label: t("tabCatalog") },
    { id: getCatalogMode() === "digital" ? "library" : "installed", label: t("uiBiblioteca") },
  ];
  const sortOptions: { id: CatalogSort; label: string }[] = [
    { id: "release-date", label: t("sortRelease") },
    { id: "steam-popularity", label: t("sortPopularity") },
    { id: "steam-review-score", label: t("sortReviewScore") },
    { id: "name", label: t("sortName") },
  ];
  const selectedSortLabel = sortOptions.find(option => option.id === catalogSort)?.label ?? t("sortLabel");

  const latestStateRef = useRef({ selectedIndex: props.selectedIndex, indexes, onSelect: props.onSelect });
  useEffect(() => {
    latestStateRef.current = { selectedIndex: props.selectedIndex, indexes, onSelect: props.onSelect };
  });

  useEffect(() => {
    const grid = props.gridRef.current;
    const room = grid?.closest<HTMLElement>(".library-room");
    if (!grid) return;
    let clampRaf = 0;
    const clampSelectionToViewport = () => {
      if (grid.dataset.tweening === "true") return;
      const selected = grid.querySelector<HTMLElement>(".is-selected");
      const gridRect = grid.getBoundingClientRect();
      const allCards = Array.from(grid.querySelectorAll<HTMLButtonElement>(".library-room-card"));
      if (!allCards.length) return;

      const visibleCards = allCards.filter(card => {
        const r = card.getBoundingClientRect();
        return r.bottom > gridRect.top + 20 && r.top < gridRect.bottom - 20;
      });
      if (!visibleCards.length) return;

      let needsClamp = false;
      let offscreenDirection: "above" | "below" = "above";
      let selectedLeft = 0;

      if (!selected) {
        needsClamp = true;
        offscreenDirection = "above";
      } else {
        const selectedRect = selected.getBoundingClientRect();
        selectedLeft = selectedRect.left;
        if (selectedRect.bottom < gridRect.top + 16) {
          needsClamp = true;
          offscreenDirection = "above";
        } else if (selectedRect.top > gridRect.bottom - 16) {
          needsClamp = true;
          offscreenDirection = "below";
        }
      }

      if (!needsClamp) return;

      let targetCards: HTMLButtonElement[];
      if (offscreenDirection === "above") {
        const minTop = Math.min(...visibleCards.map(c => c.getBoundingClientRect().top));
        targetCards = visibleCards.filter(c => Math.abs(c.getBoundingClientRect().top - minTop) < 18);
      } else {
        const maxTop = Math.max(...visibleCards.map(c => c.getBoundingClientRect().top));
        targetCards = visibleCards.filter(c => Math.abs(c.getBoundingClientRect().top - maxTop) < 18);
      }

      let bestCard = targetCards[0];
      let bestDiff = Math.abs(bestCard.getBoundingClientRect().left - selectedLeft);
      for (const card of targetCards) {
        const diff = Math.abs(card.getBoundingClientRect().left - selectedLeft);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestCard = card;
        }
      }

      const gameId = Number(bestCard.dataset.libraryGameId);
      const targetIndex = latestStateRef.current.indexes.get(gameId);
      if (targetIndex !== undefined && targetIndex !== latestStateRef.current.selectedIndex) {
        grid.dataset.scrollClamping = "true";
        latestStateRef.current.onSelect(targetIndex, false);
      }
    };

    const updateVisibility = () => {
      setShowBackToTop(grid.scrollTop > 320 || (room?.scrollTop ?? 0) > 320 || window.scrollY > 320);
      if (clampRaf) cancelAnimationFrame(clampRaf);
      clampRaf = requestAnimationFrame(clampSelectionToViewport);
    };
    grid.addEventListener("scroll", updateVisibility, { passive: true });
    room?.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("scroll", updateVisibility, { passive: true, capture: true });
    updateVisibility();
    return () => {
      if (clampRaf) cancelAnimationFrame(clampRaf);
      grid.removeEventListener("scroll", updateVisibility);
      room?.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("scroll", updateVisibility, true);
    };
  }, [props.gridRef]);

  const returnToTop = () => {
    props.gridRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    props.gridRef.current?.closest<HTMLElement>(".library-room")?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    props.onSelect(0, false);
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
        {view !== "catalog" ? (
          <div className="ga-library-pills" role="group" aria-label={t("pillsLabel")}>
            <button type="button" aria-pressed={libraryPill === "installed"} onClick={() => setLibraryPill(current => (current === "installed" ? "all" : "installed"))}>{t("pillInstalled")}</button>
            <button type="button" aria-pressed={libraryPill === "favorites"} onClick={() => setLibraryPill(current => (current === "favorites" ? "all" : "favorites"))}>{t("pillFavorites")}</button>
          </div>
        ) : null}
        <div className="ga-search-dock">
          <SteamGlobalSearch query={searchQuery} setQuery={onSearchQueryChange} />
        </div>
        <div className="library-catalog-tabs" role="tablist" aria-label={t("uiColeccionesDeJuegos")}>
          {views.map(item => <button key={item.id} type="button" role="tab" aria-label={item.label} aria-selected={view === item.id || (item.id === "installed" && view === "favorites")} className={`tab-${item.id}${view === item.id || (item.id === "installed" && view === "favorites") ? " is-active" : ""}`} onClick={() => { onViewChange(item.id); setSectionReset(value => value + 1); props.onSelect(0, false); props.gridRef.current?.scrollTo({ top: 0, behavior: "auto" }); }}>{item.id === "catalog" ? <FilledIcon name="catalog" /> : <FilledIcon name="library" />}<span>{item.label}</span></button>)}
          </div>


      </div>
      </>
  );
  const filters = <CatalogFilterToolbar
    games={props.games}
    query={searchQuery}
    filters={searchFilters}
    sortOptions={sortOptions}
    selectedSortLabel={selectedSortLabel}
    catalogSort={catalogSort}
    onSortChange={onCatalogSortChange}
    onFiltersChange={onSearchFiltersChange}
    onOpenFilters={() => setFiltersOpen(true)}
  />;
  // The manager opens from the footer dock on the right, with the other footer buttons and in their style.
  const dockTarget = props.actionsTarget?.closest(".catalog-bottom-actions")?.querySelector<HTMLElement>(".ga-dock") ?? null;
  const managerButton = view === "library" && getCatalogMode() === "digital"
    ? <GaIconButton className="ga-library-manager-button" icon={<HardDrive size={20} aria-hidden="true" />} label={t("libraryManagerButton")} pressed={managerOpen} onClick={() => togglePanel("manager")} /> : null;
  const backToTop = showBackToTop ? <button type="button" className="library-back-to-top" onClick={returnToTop} aria-label={t("uiVolverArriba")} title={t("uiVolverArriba")}><ArrowUpToLine size={17} /><span>{t("uiVolverArriba")}</span></button> : null;

  return (
    <section className="library-room-catalog">
      {filtersOpen ? <LibraryFilterDialog games={view === "installed" ? allGames.filter(game => { const status = game.app_id ? props.downloads[game.app_id] : undefined; const state = gameStateManager.resolve(status); return state.installed || state.prepared || props.preferences?.[game.id] === 1; }) : allGames} countFromCatalog={view !== "installed"} query={searchQuery} filters={searchFilters} genres={facets.genres} onApply={next => { onSearchFiltersChange(next); setFiltersOpen(false); setSectionReset(value => value + 1); props.gridRef.current?.scrollTo({ top: 0, behavior: "auto" }); }} /> : null}
      {props.toolbarTarget ? createPortal(toolbar, props.toolbarTarget) : toolbar}
      {view === "catalog" && !searchQuery.trim() ? <CatalogSpotlight exclude={props.isInstalled ?? (() => false)} onOpen={game => { const index = indexes.get(game.id); if (index !== undefined) props.onSelect(index, true); }} /> : null}
      {/* Filters and sort sit above the grid, where people look for them. */}
      <div className="ga-grid-toolbar">{filters}{view === "catalog" && props.hiddenInstalled ? <button type="button" className="ga-hidden-installed" onClick={() => { onViewChange(getCatalogMode() === "digital" ? "library" : "installed"); props.onSelect(0, false); }}>{t("catalogHiddenInstalled", { count: props.hiddenInstalled })}</button> : null}</div>
      <div className="ga-scroll-frame">
      <div ref={props.gridRef} className="library-room-grid library-section-scroll" data-cover-columns={coverColumns} style={{ "--ga-cover-floor": `${coverFloor}px`, "--ga-cover-columns": coverColumns } as CSSProperties}>
        {view !== "catalog" ? <LibraryBento games={displaySection.games} downloads={props.downloads} preferences={props.preferences} pill={libraryPill} indexes={indexes} selectedId={props.games[props.selectedIndex]?.id} onSelect={props.onSelect} onContextMenu={setContextMenu} onPlay={props.onPlay} onInstall={props.onInstall} onManage={game => { setManagerFocus(game.app_id ?? game.id); openPanel("manager"); }} /> : <LibrarySectionShelf section={displaySection} selectedId={props.games[props.selectedIndex]?.id} reset={sectionReset} scrollRoot={props.gridRef} renderGame={game => <DownloadGameCard key={game.id} game={game} index={indexes.get(game.id)!} selected={game.id === props.games[props.selectedIndex]?.id} status={(game.app_id ? props.downloads[game.app_id] : undefined) ?? props.downloads[game.id]} pinned={Boolean(game.app_id && props.pinnedAppIds.has(game.app_id))} favorite={props.preferences?.[game.id] === 1} onSelect={props.onSelect} onContextMenu={setContextMenu} />} />}
      </div>
      {typeof window !== "undefined" && !["tablet", "display"].includes(new URLSearchParams(window.location.search).get("surface") || "") ? <CircularScrollbar targetRef={props.gridRef} label={t("uiDesplazarJuegos")} /> : null}
      </div>
      {props.actionsTarget && backToTop ? createPortal(backToTop, props.actionsTarget) : null}
      {managerButton ? (dockTarget ? createPortal(managerButton, dockTarget) : managerButton) : null}
      <DeskPanel id="manager" eyebrow={t("deskLibraryEyebrow")} title={t("libraryManagerButton")}><GameLibraryManager embedded focusAppId={managerFocus} onClose={() => closePanel("manager")} catalog={props.allGames} onInstall={props.onInstall} onPlay={props.onPlay} /></DeskPanel>
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
