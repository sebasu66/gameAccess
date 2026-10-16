import { catalogParamsFromFilters, useCatalogGenreNames } from "./catalogFilterParams";
import { useLibraryDownloads } from "./useLibraryDownloads";
import RenderProbe from "./RenderProbe";
import { useLibraryGames } from "./libraryMembership";
import { applyInstalledSnapshot, STORAGE_SNAPSHOT_EVENT } from "./libraryStorageSnapshot";
import { buildLibraryCollection, type CatalogSort, type LibraryView } from "./librarySections";
import { useCatalogQuery } from "./useCatalogQuery";
import { usePlayHistory } from "./recentGames";
import { GAME_STORAGE_STATE_CHANGED_EVENT } from "./gameStorage";
import { DEFAULT_LIBRARY_FILTERS, findLibraryLetter, filterLibraryGames, LIBRARY_SEARCH_EVENT } from "./librarySearch";
import { useDesktopWindowMaximized } from "./useDesktopWindowMaximized";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MoreHorizontal, X } from "lucide-react";

import { loadDetails } from "./api";
import { useI18n } from "./i18n";
import CancelDownloadDialog from "./CancelDownloadDialog";
import { DESKTOP_IDLE_TIMEOUT_MS, HIGH_FREQUENCY_ACTIVITY_EVENTS, HIGH_FREQUENCY_ACTIVITY_TRAILING_MS, IMMEDIATE_ACTIVITY_EVENTS } from "./desktopIdle";
import DownloadCatalogPanel from "./DownloadCatalogPanel";
import DownloadCompleteDialog from "./DownloadCompleteDialog";
import { cancelManagedDownload } from "./downloadCancellation";
import { acknowledgeDownloadCompletion, cancelDownloadLifecycle } from "./downloadLifecycle";
import { downloadManager } from "./downloadManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { buildActions, EmptyLibraryContent, FeaturePanel, handleActionKey, handleGridKey, LibraryHint, libraryRoomClass, selectedDownload, selectedHero, selectedPortraitHero, selectedWideArtworkSlides, selectedMovie, selectedSummary, selectedVideo, useCrossfadeArtwork } from "./LibraryRoomParts";
import { gameStateManager } from "./GameStateManager";
import type { DownloadMap, FocusZone } from "./LibraryRoomParts";
import { renderedGridColumns } from "./libraryNavigation";
import BigScreenControls from "./BigScreenControls";
import { useOverlayClose } from "./useOverlayClose";
import OverlayScreenDimmer from "./OverlayScreenDimmer";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LibrarySearchEventDetail, LibrarySearchFilters } from "./librarySearch";
import { steamDownloadStatus } from "./native";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { getCatalogMode } from "./catalogMode";
import { TOGGLE_COLLECTION_EVENT } from "./LibraryInputController";
import DigitalGameContextMenu from "./DigitalGameContextMenu";
import GameStorageContextMenu from "./GameStorageContextMenu";
import { playUiSound } from "./uiSounds";
import type { CatalogGame, GameDetails } from "./types";

interface LibraryRoomProps {
  toolbarTarget?: HTMLDivElement | null;
  actionsTarget?: HTMLDivElement | null;
  games: CatalogGame[];
  downloads: DownloadMap;
  busy: boolean;
  onPlay: (game: CatalogGame) => void | Promise<void>;
  onDownload: (game: CatalogGame) => void | Promise<void>;
  externalDetailGame?: CatalogGame | null;
  onDetailClose?: () => void;
  preferences?: Record<number, 1 | -1>;
  onPreference?: (gameId: number, value: 1 | -1) => void;
  loading?: boolean;
  catalogUnavailable?: boolean;
  searchFilters?: LibrarySearchFilters;
  onSearchFiltersChange?: (filters: LibrarySearchFilters) => void;
  searchValue?: string;
  onSearchQueryChange?: (query: string) => void;
}


const IDLE_SHOWCASE_ENABLED = false;

export default function LibraryRoom({ externalDetailGame = null, onDetailClose, toolbarTarget, actionsTarget, games, downloads, busy, onPlay, onDownload, preferences = {}, onPreference = () => undefined, loading = false, catalogUnavailable = false, searchFilters = DEFAULT_LIBRARY_FILTERS, onSearchFiltersChange = () => undefined, searchValue = "", onSearchQueryChange = () => undefined }: LibraryRoomProps) {
  const { locale, t } = useI18n();
  const auxiliarySurface = typeof window !== "undefined" && ["tablet", "display"].includes(new URLSearchParams(window.location.search).get("surface") ?? "");
  const rootRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const showcaseEnteredRef = useRef(false);
  const completionHandlingRef = useRef(new Set<string>());

  const [selectedGameId, setSelectedGameId] = useState<number | null>(() => games[0]?.id ?? null);
  const [detailRequestedGameId, setDetailRequestedGameId] = useState<number | null>(null);
  const [focusZone, setFocusZone] = useState<FocusZone>("grid");
  const [actionIndex, setActionIndex] = useState(0);
  const [columns, setColumns] = useState(4);
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [detailsGameId, setDetailsGameId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(Boolean(externalDetailGame));
  useEffect(() => {
    setDetailOpen(Boolean(externalDetailGame));
    setDetailMenu(null);
  }, [externalDetailGame?.id]);
  const [detailMenu, setDetailMenu] = useState<{ game: CatalogGame; x: number; y: number; status?: ManagedDownloadStatus } | null>(null);
  const detailCloseRef = useRef<HTMLButtonElement>(null);
  const detailDialogRef = useRef<HTMLDivElement>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showcaseMode, setShowcaseMode] = useState(false);
  const [readyVideoSrc, setReadyVideoSrc] = useState<string | null>(null);
  const [videoMuted, setVideoMuted] = useState(true);
  const [videoVolume, setVideoVolume] = useState(0.68);
  const { managedDownloads, setManagedDownloads, trackedAppIds, setTrackedAppIds,
    completionQueue, setCompletionQueue, effectiveDownloads, persistCompletion } = useLibraryDownloads(games, downloads);
  const [cancelGame, setCancelGame] = useState<CatalogGame | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [libraryView, setLibraryView] = useState<LibraryView>("catalog");
  const [catalogSort, setCatalogSort] = useState<CatalogSort>("steam-popularity");
  const isWindowMaximized = useDesktopWindowMaximized();
  const [artworkSlideIndex, setArtworkSlideIndex] = useState(0);
  const [bigScreen, setBigScreen] = useState(false);
  const previousFullscreen = useRef(false);
  const toggleBigScreen = async () => {
  const { t } = useI18n();
    const next = !bigScreen;
    setBigScreen(next);
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const appWindow = getCurrentWindow();
        if (next) previousFullscreen.current = await appWindow.isFullscreen();
        await appWindow.setFullscreen(next || previousFullscreen.current);
      } else if (next) await document.documentElement.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* The large, controller-friendly layout still works windowed. */ }
  };
  useEffect(() => {
    document.body.classList.toggle("ga-big-screen", bigScreen);
    return () => document.body.classList.remove("ga-big-screen");
  }, [bigScreen]);


  const isCatalog = libraryView === "catalog";
  const nativeCatalog = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const activeQuery = (searchValue || searchQuery || "").trim();
  const genreNames = useCatalogGenreNames();
  const catalogQuery = useCatalogQuery({
    ...catalogParamsFromFilters(activeQuery, searchFilters, genreNames),
    sort_by: catalogSort,
    sort_direction: catalogSort === "name" ? "asc" : "desc",
    limit: 1000,
    enabled: isCatalog,
  });

  const history = usePlayHistory();
  const members = useLibraryGames();
  const libraryIds = useMemo(() => new Set(members.map(game => game.app_id ?? game.id)), [members]);
  const hasInstalledGames = useMemo(() => games.some(game => { const state = gameStateManager.resolve(game.app_id ? effectiveDownloads[game.app_id] : undefined); return state.installed || state.prepared; }), [games, effectiveDownloads]);
  const hasFavoriteGames = useMemo(() => games.some(game => preferences[game.id] === 1), [games, preferences]);
  const catalogCollection = useMemo(() => {
    if (libraryView === "catalog") {
      // The grid shows the database answer, even when it is empty. Only without the
      // database (browser preview, tests) or on a query error does it filter what is in memory.
      const memoryOnly = !nativeCatalog || Boolean(catalogQuery.error);
      const sourceItems = memoryOnly ? filterLibraryGames(games, activeQuery, searchFilters) : catalogQuery.items;
      const items = downloadManager.pinGames(sourceItems, effectiveDownloads, trackedAppIds);
      const titles: Record<CatalogSort, string> = {
        "release-date": "Catálogo · lanzamientos recientes",
        "steam-popularity": "Catálogo · popularidad en Steam",
        "steam-review-score": "Catálogo · puntuación de Steam",
        "name": "Catálogo · A–Z",
      };
      const descriptions: Record<CatalogSort, string> = {
        "release-date": "Todos los juegos ordenados por fecha de lanzamiento, del más reciente al más antiguo.",
        "steam-popularity": "Todos los juegos ordenados por popularidad en Steam (recomendaciones o cantidad de reseñas).",
        "steam-review-score": "Todos los juegos ordenados por puntuación de reseñas de Steam.",
        "name": "Todos los juegos disponibles, ordenados alfabéticamente.",
      };
      return {
        id: "catalog" as const,
        title: titles[catalogSort] ?? "Catálogo",
        description: descriptions[catalogSort],
        games: items,
        total: memoryOnly ? sourceItems.length : catalogQuery.total,
      };
    }
    const nonCatalogGames = filterLibraryGames(games, activeQuery, searchFilters);
    return buildLibraryCollection(
      downloadManager.pinGames(nonCatalogGames, effectiveDownloads, trackedAppIds),
      effectiveDownloads,
      preferences,
      history,
      libraryView,
      catalogSort,
      libraryIds,
    );
  }, [libraryView, catalogQuery.items, catalogQuery.total, catalogQuery.error, catalogSort, games, activeQuery, searchFilters, effectiveDownloads, trackedAppIds, preferences, history, libraryIds]);
  const displayGames = catalogCollection.games;
  const selectedIndexRaw = displayGames.findIndex((game) => game.id === selectedGameId);
  const selectedIndex = selectedIndexRaw >= 0 ? selectedIndexRaw : 0;
  // Downloads may refer to games outside the current search, collection or catalog.
  const selectedGame = externalDetailGame
    ? games.find(game => game.id === externalDetailGame.id) ?? displayGames.find(game => game.id === externalDetailGame.id) ?? externalDetailGame
    : selectedIndexRaw >= 0 ? displayGames[selectedIndexRaw] : displayGames[0];
  const selectedGameIdResolved = selectedGame?.id;
  const selectedAppId = selectedGame?.app_id ?? selectedGame?.id;
  const download = selectedDownload(selectedAppId, effectiveDownloads);
  // Selected-game probes and storage events replace stale local completion overlays.
  useEffect(() => {
    if (getCatalogMode() === "digital") return;
    const changed = (event: Event) => {
      const status = (event as CustomEvent<{ status?: ManagedDownloadStatus }>).detail?.status;
      if (!status?.app_id) return;
      setManagedDownloads((current) => ({ ...current, [status.app_id]: status }));
    };
    const snapshot = (event: Event) => setManagedDownloads(current => applyInstalledSnapshot(current, (event as CustomEvent<number[]>).detail));
    window.addEventListener(GAME_STORAGE_STATE_CHANGED_EVENT, changed);
    window.addEventListener(STORAGE_SNAPSHOT_EVENT, snapshot);
    return () => { window.removeEventListener(GAME_STORAGE_STATE_CHANGED_EVENT, changed); window.removeEventListener(STORAGE_SNAPSHOT_EVENT, snapshot); };
  }, []);
  useEffect(() => {
    if (!selectedAppId) return;
    let cancelled = false;
    let pending = false;
    const probe = async () => {
      if (pending) return;
      pending = true;
      try {
        const isDigitalGame = selectedGame && !((selectedGame as any).use_game_access === true || (selectedGame as any).is_game_access === true);
        const status = isDigitalGame
          ? await digitalCatalogService.getStatus(selectedGame!)
          : await steamDownloadStatus(selectedAppId);
        if (!cancelled && status.state !== "unknown") {
          setManagedDownloads((current) => {
            const existing = current[selectedAppId];
            if (
              existing &&
              existing.state === status.state &&
              existing.installed === status.installed &&
              existing.progress === status.progress &&
              existing.job_id === status.job_id
            ) {
              return current;
            }
            return { ...current, [selectedAppId]: status };
          });
        }
      } catch { /* Keep last known state until a successful probe. */ }
      finally { pending = false; }
    };
    const initialDelay = window.setTimeout(() => void probe(), 150);
    const timer = window.setInterval(() => void probe(), 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialDelay);
      window.clearInterval(timer);
    };
  }, [selectedAppId]);
  const installed = gameStateManager.resolve(download).installed;
  const activeDownload = downloadManager.isTracked(download);
  const detailDownload = download;
  const currentDetails = detailsGameId === selectedGameIdResolved ? details : null;
  const fallbackHero = selectedHero(currentDetails, selectedGame);
  const portraitHero = selectedPortraitHero(selectedGame);
  const wideArtworkSlides = selectedWideArtworkSlides(currentDetails, selectedGame);
  const wideHero = wideArtworkSlides.length ? wideArtworkSlides[artworkSlideIndex % wideArtworkSlides.length] : undefined;
  const hero = (isWindowMaximized ? (wideHero ?? fallbackHero) : (portraitHero ?? fallbackHero));
  const movie = selectedMovie(currentDetails);
  const videoSrc = selectedVideo(movie);
  const artwork = useCrossfadeArtwork(auxiliarySurface ? hero : undefined);
  const summary = selectedSummary(currentDetails);
  const actions = useMemo(() => buildActions(selectedGame, download, busy), [selectedGame, download, busy]);
  const currentCompletion = completionQueue[0];


  useEffect(() => {
    const handleSearch = (event: Event) => {
      const { query } = (event as CustomEvent<LibrarySearchEventDetail>).detail ?? {};
      setSearchQuery(typeof query === "string" ? query : "");
    };
    window.addEventListener(LIBRARY_SEARCH_EVENT, handleSearch);
    return () => window.removeEventListener(LIBRARY_SEARCH_EVENT, handleSearch);
  }, []);

  useEffect(() => {
    if (!displayGames.length) {
      setSelectedGameId(null);
      return;
    }
    if (selectedGameId != null && displayGames.some((game) => game.id === selectedGameId)) return;
    setSelectedGameId(displayGames[0].id);
  }, [displayGames, selectedGameId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Selection/layout changes reset the slideshow to its first image.
  useEffect(() => {
    setArtworkSlideIndex(0);
  }, [selectedGameIdResolved, isWindowMaximized]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Restart the image dwell timer when selecting another game.
  useEffect(() => {
    if (!isWindowMaximized || wideArtworkSlides.length < 2) return;
    const timer = window.setInterval(() => {
      setArtworkSlideIndex((current) => (current + 1) % wideArtworkSlides.length);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [isWindowMaximized, selectedGameIdResolved, wideArtworkSlides.length]);


  const markActivity = useCallback(() => {
    setShowcaseMode(false);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    // The idle "showcase" (jumping to a random game on its own) is switched off until it is designed properly.
    if (!IDLE_SHOWCASE_ENABLED) return;
    idleTimerRef.current = window.setTimeout(() => {
      setFocusZone("grid");
      setShowcaseMode(true);
    }, DESKTOP_IDLE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    markActivity();
    let trailingTimer: number | null = null;
    const immediate = () => markActivity();
    const highFrequency = () => {
      if (trailingTimer !== null) window.clearTimeout(trailingTimer);
      trailingTimer = window.setTimeout(() => { trailingTimer = null; markActivity(); }, HIGH_FREQUENCY_ACTIVITY_TRAILING_MS);
    };
    const visibleAgain = () => { if (document.visibilityState === "visible") markActivity(); };
    for (const eventName of IMMEDIATE_ACTIVITY_EVENTS) window.addEventListener(eventName, immediate, { passive: true });
    for (const eventName of HIGH_FREQUENCY_ACTIVITY_EVENTS) window.addEventListener(eventName, highFrequency, { passive: true });
    document.addEventListener("visibilitychange", visibleAgain);
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      if (trailingTimer !== null) window.clearTimeout(trailingTimer);
      for (const eventName of IMMEDIATE_ACTIVITY_EVENTS) window.removeEventListener(eventName, immediate);
      for (const eventName of HIGH_FREQUENCY_ACTIVITY_EVENTS) window.removeEventListener(eventName, highFrequency);
      document.removeEventListener("visibilitychange", visibleAgain);
    };
  }, [markActivity]);

  useEffect(() => {
    if (!showcaseMode) { showcaseEnteredRef.current = false; return; }
    if (displayGames.length < 2 || showcaseEnteredRef.current) return;
    showcaseEnteredRef.current = true;
    let next = Math.floor(Math.random() * displayGames.length);
    if (next === selectedIndex) next = (next + 1) % displayGames.length;
    setSelectedGameId(displayGames[next]?.id ?? null);
  }, [showcaseMode, displayGames, selectedIndex]);

  useEffect(() => {
    if (!showcaseMode || displayGames.length < 2 || selectedGameIdResolved == null) return;
    const holdMs = videoSrc ? 110_000 : 90_000;
    const timer = window.setTimeout(() => {
      let next = Math.floor(Math.random() * displayGames.length);
      if (next === selectedIndex) next = (next + 1) % displayGames.length;
      setSelectedGameId(displayGames[next]?.id ?? null);
    }, holdMs);
    return () => window.clearTimeout(timer);
  }, [showcaseMode, displayGames, selectedGameIdResolved, selectedIndex, videoSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = videoVolume;
    video.muted = videoMuted;
  }, [videoVolume, videoMuted]);

  useEffect(() => {
    if (!displayGames.length) return;
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const first = grid.querySelector<HTMLElement>(".library-room-card");
      if (!first) return;
      const shelf = first.closest<HTMLElement>(".library-section-grid") ?? grid;
      setColumns(renderedGridColumns(getComputedStyle(shelf).gridTemplateColumns));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    const shelf = grid.querySelector<HTMLElement>(".library-section-grid");
    if (shelf) observer.observe(shelf);
    measure();
    return () => observer.disconnect();
  }, [displayGames.length, bigScreen]);


  useEffect(() => {
    const shouldLoadDetails = auxiliarySurface && detailRequestedGameId === selectedGameIdResolved;
    if (!shouldLoadDetails || selectedGameIdResolved == null) {
      setDetails(null);
      setDetailsGameId(null);
      setLoadingDetails(false);
      return;
    }
    let cancelled = false;
    const requestedGameId = selectedGameIdResolved;
    setDetails(null);
    setDetailsGameId(null);
    setLoadingDetails(true);
    loadDetails(requestedGameId)
      .then((value) => { if (!cancelled) { setDetails(value); setDetailsGameId(requestedGameId); } })
      .catch(() => { if (!cancelled) setDetails(null); })
      .finally(() => { if (!cancelled) setLoadingDetails(false); });
    return () => { cancelled = true; };
  }, [selectedGameIdResolved, detailRequestedGameId, auxiliarySurface, locale]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A changed selection or primary action resets keyboard action focus.
  useEffect(() => { setActionIndex(0); }, [selectedGameIdResolved, actions[0]?.kind]);

  const moveGrid = (delta: number) => {
    // The shelf reveals the requested card, including the next lazy batch.
    const next = Math.max(0, Math.min(displayGames.length - 1, selectedIndex + delta));
    if (next < 0) return;
    if (next === selectedIndex) return;
    playUiSound("move");
    const gameId = displayGames[next]?.id ?? null;
    setSelectedGameId(gameId);
    setDetailRequestedGameId(gameId);
  };

  const enterActions = () => {
    playUiSound("activate");
    setFocusZone("actions");
    window.requestAnimationFrame(() => actionRefs.current[0]?.focus({ preventScroll: true }));
  };
  const returnToGrid = () => { setFocusZone("grid"); rootRef.current?.focus({ preventScroll: true }); };

  useEffect(() => {
    if (!detailOpen || auxiliarySurface) return;
    const frame = window.requestAnimationFrame(() => detailCloseRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [detailOpen, auxiliarySurface]);

  const { closing: detailClosing, close: closeGameDetail } = useOverlayClose(() => {
    setDetailOpen(false);
    setDetailMenu(null);
    onDetailClose?.();
    window.requestAnimationFrame(() => {
      const selected = selectedGameIdResolved == null ? null : gridRef.current?.querySelector<HTMLElement>(`[data-library-game-id="${selectedGameIdResolved}"]`);
      (selected ?? rootRef.current)?.focus({ preventScroll: true });
    });
  });

  // Tab (handled by LibraryInputController) flips between Catalog and Library.
  useEffect(() => {
    if (auxiliarySurface) return;
    const toggle = () => {
      setLibraryView(current => (current === "catalog" ? (getCatalogMode() === "digital" ? "library" : "installed") : "catalog"));
      setSelectedGameId(null);
      gridRef.current?.scrollTo({ top: 0 });
    };
    window.addEventListener(TOGGLE_COLLECTION_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_COLLECTION_EVENT, toggle);
  }, [auxiliarySurface]);

  // Esc always backs out of a game's detail, even when the focus is not inside the library.
  useEffect(() => {
    if (!detailOpen || auxiliarySurface) return;
    const back = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.ga-detail-overlay)')) return;
      event.preventDefault();
      if (detailMenu) setDetailMenu(null); else closeGameDetail();
    };
    window.addEventListener("keydown", back);
    return () => window.removeEventListener("keydown", back);
  }, [detailOpen, auxiliarySurface, detailMenu, closeGameDetail]);

  const startVideoPastIntro = (video: HTMLVideoElement) => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const gameplayStart = duration > 0 ? Math.min(Math.max(7, duration * 0.14), Math.max(0, duration - 4)) : 7;
    try { video.currentTime = gameplayStart; } catch { /* WebView metadata race */ }
    video.volume = videoVolume;
    video.muted = videoMuted;
    void video.play().catch(() => undefined);
  };
  const handleVideoReady = (video: HTMLVideoElement) => { setReadyVideoSrc(videoSrc ?? null); void video.play().catch(() => undefined); };
  const toggleVideoSound = () => {
    const nextMuted = !videoMuted;
    setVideoMuted(nextMuted);
    const video = videoRef.current;
    if (!video) return;
    video.muted = nextMuted;
    video.volume = videoVolume;
    if (!nextMuted) void video.play().catch(() => undefined);
  };
  const changeVideoVolume = (value: number) => {
    setVideoVolume(value);
    setVideoMuted(value <= 0);
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value <= 0;
    if (value > 0) void video.play().catch(() => undefined);
  };

  const onAction = (index: number) => {
    setActionIndex(index);
    const action = actions[index];
    if (!action || action.disabled || !selectedGame) return;
    playUiSound("activate");
    if (action.kind === "play") void onPlay(selectedGame);
    else if (action.kind === "download") void onDownload(selectedGame);
    else if (action.kind === "cancel") {
      setCancelError(null);
      setCancelling(false);
      setCancelGame(selectedGame);
    }
  };
  const activateAction = () => onAction(actionIndex);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "F11" && !auxiliarySurface) { event.preventDefault(); void toggleBigScreen(); return; }
    if (event.key === "Escape" && detailOpen) {
      event.preventDefault();
      event.stopPropagation();
      if (detailMenu) setDetailMenu(null);
      else closeGameDetail();
      return;
    }
    if (detailOpen && event.key === "Tab") {
      const dialog = event.currentTarget.querySelector<HTMLElement>(".ga-detail-overlay");
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []).filter(node => node.getClientRects().length > 0);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    // Detail controls use native button/scroll keyboard behavior, without moving the grid.
    if (detailOpen) return;
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]"))) return;
    if (event.target instanceof HTMLElement && event.target.closest(".library-section-heading button, .library-section-pages button, .library-catalog-toolbar button, .library-catalog-filter-actions, .ga-big-screen-toggle, .ga-pad-keyboard")) return;
    markActivity();
    const letterIndex = findLibraryLetter(displayGames, event.key, selectedIndex);
    if (letterIndex >= 0) {
      event.preventDefault();
      onSelectGame(letterIndex, false);
      return;
    }
    if (!selectedGame) {
      const key = event.key.toLowerCase();
      if (displayGames.length && ["enter", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
        const gameId = displayGames[0]?.id ?? null;
        setSelectedGameId(gameId);
        setDetailRequestedGameId(gameId);
        event.preventDefault();
      }
      return;
    }
    if (focusZone === "grid" && event.key.toLowerCase() === "enter") {
      event.preventDefault();
      setDetailRequestedGameId(selectedGame.id);
      setDetailOpen(true);
      return;
    }
    const context = { actionIndex, actionRefs, setActionIndex, returnToGrid, activateAction };
    const gridContext = { selectedIndex, columns, enterActions, moveGrid };
    const handled = focusZone === "actions" ? handleActionKey(event.key.toLowerCase(), context) : handleGridKey(event.key.toLowerCase(), gridContext);
    if (handled) event.preventDefault();
  };

  const onSelectGame = (index: number, openDetails = true) => {
    const gameId = displayGames[index]?.id ?? null;
    setSelectedGameId(gameId);
    setDetailRequestedGameId(gameId);
    setFocusZone("grid");
    if (openDetails && gameId != null) setDetailOpen(true);
  };

  const dismissCompletion = async (play: boolean) => {
    const entry = completionQueue[0];
    if (!entry || completionHandlingRef.current.has(entry.record.job_id)) return;
    completionHandlingRef.current.add(entry.record.job_id);
    try {
      await acknowledgeDownloadCompletion(entry.record.job_id);
      setCompletionQueue((current) => current.filter((item) => item.record.job_id !== entry.record.job_id));
      if (play) void onPlay(entry.game);
    } finally {
      completionHandlingRef.current.delete(entry.record.job_id);
    }
  };

  const confirmCancellation = async () => {
    if (!cancelGame?.app_id || cancelling) return;
    const appId = cancelGame.app_id;
    const status = effectiveDownloads[appId];
    setCancelling(true);
    setCancelError(null);
    try {
      const result = await cancelManagedDownload(appId, status?.job_id);
      if (!result.supported) {
        setCancelError(result.message ?? "Esta descarga debe administrarse desde Steam.");
        return;
      }
      if (result.status) {
        const next = result.status as ManagedDownloadStatus;
        setManagedDownloads((current) => ({ ...current, [appId]: next }));
        if (next.installed || next.state === "installed") {
          await persistCompletion(appId);
        } else if (next.state === "cancelled") {
          await cancelDownloadLifecycle(appId).catch(() => undefined);
          setTrackedAppIds((current) => current.filter((id) => id !== appId));
        }
      }
      setCancelGame(null);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : String(error));
    } finally {
      setCancelling(false);
    }
  };

  const windowLayoutClass = isWindowMaximized ? "is-maximized" : "";
  const rootClass = `${libraryRoomClass(focusZone, showcaseMode, Boolean(selectedGame))} ${windowLayoutClass}`.trim();
  const pinnedAppIds = useMemo(() => new Set(trackedAppIds), [trackedAppIds]);

  const detailPanel = selectedGame ? (
    <FeaturePanel
      game={selectedGame}
      artwork={artwork}
      movie={movie}
      videoSrc={videoSrc}
      readyVideoSrc={readyVideoSrc}
      videoMuted={videoMuted}
      videoVolume={videoVolume}
      videoRef={videoRef}
      onVideoMetadata={startVideoPastIntro}
      onVideoReady={handleVideoReady}
      onToggleSound={toggleVideoSound}
      onVolumeChange={changeVideoVolume}
      showcaseMode={showcaseMode}
      summary={summary}
      loadingDetails={loadingDetails}
      details={currentDetails}
      download={detailDownload}
      preference={preferences[selectedGame.id]}
      onPreference={(value) => onPreference(selectedGame.id, value)}
      actions={actions}
      focusZone={focusZone}
      actionIndex={actionIndex}
      actionRefs={actionRefs}
      setFocusZone={setFocusZone}
      setActionIndex={setActionIndex}
      onAction={onAction}
    />
  ) : null;

  return (
    <section ref={rootRef} className={rootClass} tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={markActivity} aria-label={t("uiBiblioteca")}>
      {!auxiliarySurface ? <BigScreenControls footerTarget={actionsTarget} enabled={bigScreen} onToggle={() => void toggleBigScreen()} onDirection={key => { markActivity(); handleGridKey(key, { selectedIndex, columns, enterActions, moveGrid }); }} onAccept={() => { markActivity(); if(selectedGame) { setDetailRequestedGameId(selectedGame.id); setDetailOpen(true); } }} onBack={() => { if(detailOpen) closeGameDetail(); else if(bigScreen) void toggleBigScreen(); }} onView={view => { markActivity(); setLibraryView(view === "installed" && getCatalogMode() === "digital" ? "library" : view); }} query={searchValue} onQuery={onSearchQueryChange} /> : null}
      {displayGames.length > 0 || games.length > 0 || catalogQuery.loading || externalDetailGame ? (
        <>
          {auxiliarySurface && selectedGame ? detailPanel : null}
          {!auxiliarySurface && detailOpen && selectedGame ? <div className={`ga-detail-overlay${detailClosing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeGameDetail(); }}>
            <OverlayScreenDimmer panelRef={detailDialogRef} />
            <div ref={detailDialogRef} className="ga-detail-dialog" role="dialog" aria-modal="true" aria-label={`Detalles de ${selectedGame.name}`} tabIndex={-1}>
              <button ref={detailCloseRef} type="button" className="ga-detail-close" onClick={closeGameDetail} aria-label={t("uiCerrarDetalles")}><X size={23} strokeWidth={2.5} /></button>
              <button type="button" className="ga-detail-more" aria-label={`Más opciones para ${selectedGame.name}`} aria-haspopup="menu" aria-expanded={Boolean(detailMenu)} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setDetailMenu(current => current ? null : { game: selectedGame, x: rect.left, y: rect.bottom + 6, status: selectedAppId ? effectiveDownloads[selectedAppId] : undefined }); }}><MoreHorizontal size={25} fill="currentColor" /></button>
              {detailPanel}
            </div>
            {detailMenu ? (getCatalogMode() === "digital"
              ? <DigitalGameContextMenu request={detailMenu} onClose={() => setDetailMenu(null)} onInstall={onDownload} onPlay={onPlay} />
              : <GameStorageContextMenu request={detailMenu} onClose={() => setDetailMenu(null)} onInstall={onDownload} onPlay={onPlay} />) : null}
          </div> : null}
          <RenderProbe id="CatalogPanel"><DownloadCatalogPanel toolbarTarget={auxiliarySurface ? null : toolbarTarget} actionsTarget={actionsTarget} games={displayGames} allGames={games} searchQuery={searchValue} onSearchQueryChange={onSearchQueryChange} searchFilters={searchFilters} onSearchFiltersChange={onSearchFiltersChange} section={catalogCollection} view={libraryView} onViewChange={setLibraryView} catalogSort={catalogSort} onCatalogSortChange={setCatalogSort} hasInstalled={hasInstalledGames} hasFavorites={hasFavoriteGames} catalogUnavailable={catalogUnavailable} catalogTotal={isCatalog ? catalogCollection.total : undefined} catalogLoading={isCatalog ? catalogQuery.loading : undefined} downloads={effectiveDownloads} selectedIndex={selectedIndex} gridRef={gridRef} pinnedAppIds={pinnedAppIds} preferences={preferences} history={history} onSelect={onSelectGame} onInstall={onDownload} onPlay={onPlay} /></RenderProbe>
        </>
      ) : <EmptyLibraryContent gridRef={gridRef} loading={loading} />}
      <LibraryHint />
      {currentCompletion ? <DownloadCompleteDialog game={currentCompletion.game} busy={busy} onPlay={() => void dismissCompletion(true)} onClose={() => void dismissCompletion(false)} /> : null}
      {cancelGame ? <CancelDownloadDialog game={cancelGame} cancelling={cancelling} error={cancelError} onKeep={() => { if (!cancelling) setCancelGame(null); }} onConfirm={() => void confirmCancellation()} /> : null}
    </section>
  );
}

