import { catalogParamsFromFilters, useCatalogGenreNames } from "./catalogFilterParams";
import { useLibraryDownloads } from "./useLibraryDownloads";
import RenderProbe from "./RenderProbe";
import { useLibraryGames } from "./libraryMembership";
import { applyInstalledSnapshot, STORAGE_SNAPSHOT_EVENT } from "./libraryStorageSnapshot";
import { buildLibraryCollection, type CatalogSort, type LibraryView } from "./librarySections";
import { useCatalogQuery } from "./useCatalogQuery";
import { buildTasteProfile, rememberTasteGame, tailorCatalog, tasteQuery } from "./tasteProfile";
import { publishTasteReadiness, usePersonalOrder } from "./personalOrder";
import { usePlayHistory } from "./recentGames";
import { GAME_STORAGE_STATE_CHANGED_EVENT } from "./gameStorage";
import { DEFAULT_LIBRARY_FILTERS, findLibraryLetter, filterLibraryGames, LIBRARY_SEARCH_EVENT } from "./librarySearch";
import { applyParentalPolicy } from "./parentalControl";
import { useParentalState } from "./ParentalControlSection";
import { useDesktopWindowMaximized } from "./useDesktopWindowMaximized";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MoreHorizontal, X } from "lucide-react";

import { loadDetails } from "./api";
import { translate, useI18n } from "./i18n";
import CancelDownloadDialog from "./CancelDownloadDialog";
import { DESKTOP_IDLE_TIMEOUT_MS, HIGH_FREQUENCY_ACTIVITY_EVENTS, HIGH_FREQUENCY_ACTIVITY_TRAILING_MS, IMMEDIATE_ACTIVITY_EVENTS } from "./desktopIdle";
import DownloadCatalogPanel from "./DownloadCatalogPanel";
import { showNotice } from "./notice/notice";
import { bigPictureActive, controllerConnected, setBigPictureActive } from "./bigPicture";
import { hideForBigPicture, labelOut, showAfterBigPicture } from "./motion/bigPictureMotion";
import { closeAllPanels } from "./desk/desk";
import { usePluginReady } from "./usePluginReady";
import { withoutSourceFilters } from "./librarySearch";
import { noticeGame } from "./notice/noticeGame";
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
import { morphClose, morphOpen, pushCards, releaseCards, restoreSource } from "./motion/detailMorph";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LibrarySearchEventDetail, LibrarySearchFilters } from "./librarySearch";
import { steamDownloadStatus } from "./native";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { getCatalogMode } from "./catalogMode";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { TOGGLE_COLLECTION_EVENT } from "./LibraryInputController";
import DigitalGameContextMenu from "./DigitalGameContextMenu";
import GameStorageContextMenu from "./GameStorageContextMenu";
import { playUiSound } from "./uiSounds";
import type { CatalogGame, GameDetails } from "./types";
import { uiDemo } from "./devDemo/uiDemo";
import ViewRail from "./ViewRail";
import { gsap, motionOk } from "./motion/gsap";

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

/**
 * How far the catalog screen goes: the position (in the last catalog order) of the last card visible now, or at least
 * as many games as there are cards on screen. Read when the order is recomputed, before the new one is drawn.
 */
function catalogScreenEnd(last: CatalogGame[]): number {
  if (typeof document === "undefined") return 0;
  const index = new Map(last.map((game, position) => [String(game.id), position]));
  if (!last.length) return 0;
  let end = 0, onScreen = 0;
  for (const card of document.querySelectorAll<HTMLElement>(".library-room [data-library-game-id]")) {
    if (card.closest(".ga-detail-overlay")) continue;
    const box = card.getBoundingClientRect();
    if (!box.width || box.bottom <= 0 || box.top >= window.innerHeight) continue;
    onScreen++;
    const position = index.get(card.dataset.libraryGameId ?? "");
    if (position !== undefined) end = Math.max(end, position + 1);
  }
  return Math.max(end, onScreen);
}

export default function LibraryRoom({ externalDetailGame: externalDetailGameProp = null, onDetailClose, toolbarTarget, actionsTarget, games, downloads, busy, onPlay, onDownload, preferences = {}, onPreference = () => undefined, loading = false, catalogUnavailable = false, searchFilters = DEFAULT_LIBRARY_FILTERS, onSearchFiltersChange = () => undefined, searchValue = "", onSearchQueryChange = () => undefined }: LibraryRoomProps) {
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
  // A game opened from inside the catalog that is not in the grid (the banner's newest games) opens like an outside one.
  const [ownDetailGame, setOwnDetailGame] = useState<CatalogGame | null>(null);
  const externalDetailGame = externalDetailGameProp ?? ownDetailGame;
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
  /**
   * Big picture mode (bigPicture.ts): only with a controller connected. Entering closes the panels and the game detail
   * and shows the library; downloads keep going. F11, this button and the controller's Menu button leave it.
   */
  // The change is animated (motion/bigPictureMotion.ts): a second press while it runs is ignored.
  const bigScreenChanging = useRef(false);
  const toggleBigScreen = async () => {
    if (bigScreenChanging.current) return;
    const next = !bigScreen;
    if (next && !(await controllerConnected())) {
      showNotice({ tone: "info", title: t("bigPictureNoControllerTitle"), text: t("bigPictureNoControllerText"), timer: true });
      return;
    }
    bigScreenChanging.current = true;
    if (next) {
      closeAllPanels();
      setDetailMenu(null);
      setDetailOpen(false);
      // The controls the mode hides slide away first; then the library shows with only its ready games.
      await hideForBigPicture();
      setLibraryView(getCatalogMode() === "digital" ? "library" : "installed");
    } else await labelOut();
    setBigPictureActive(next);
    setBigScreen(next);
    if (!next) showAfterBigPicture();
    bigScreenChanging.current = false;
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
    // The cleanup runs on every change too, so the current value is set here again after it.
    setBigPictureActive(bigScreen);
    return () => { document.body.classList.remove("ga-big-screen"); setBigPictureActive(false); };
  }, [bigScreen]);


  // Changing between catalog and library: the new view turns in from the side it comes from (3D slide).
  const previousView = useRef(libraryView);
  useEffect(() => {
    const before = previousView.current;
    previousView.current = libraryView;
    const host = rootRef.current?.querySelector<HTMLElement>(".library-room-catalog");
    if (!host || before === libraryView || auxiliarySurface || !motionOk()) return;
    const into = libraryView === "catalog" ? -1 : 1;
    const tween = gsap.fromTo(host, { xPercent: 30 * into, rotationY: -28 * into, opacity: 0, transformPerspective: 1800, transformOrigin: into > 0 ? "100% 50%" : "0% 50%" },
      { xPercent: 0, rotationY: 0, opacity: 1, duration: .9, ease: "expo.out", clearProps: "transform,opacity" });
    return () => { tween.kill(); };
  }, [libraryView, auxiliarySurface]);
  const isCatalog = libraryView === "catalog";
  const nativeCatalog = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || uiDemo());
  const activeQuery = (searchValue || searchQuery || "").trim();
  const genreNames = useCatalogGenreNames();
  // The parental policy wins over the player's filters in every view (catalog, library, favorites).
  const parentalPolicy = useParentalState().policy;
  // Without a ready source plugin there are no download sources to filter by (librarySearch.withoutSourceFilters).
  const pluginReady = usePluginReady();
  const visibleFilters = useMemo(() => applyParentalPolicy(pluginReady === false ? withoutSourceFilters(searchFilters) : searchFilters, parentalPolicy), [searchFilters, parentalPolicy, pluginReady]);
  const catalogBase = useMemo(() => ({
    ...catalogParamsFromFilters(activeQuery, visibleFilters, genreNames),
    sort_by: catalogSort,
    sort_direction: catalogSort === "name" ? "asc" as const : "desc" as const,
  }), [activeQuery, visibleFilters, genreNames, catalogSort]);
  const catalogQuery = useCatalogQuery({ ...catalogBase, limit: 1000, enabled: isCatalog });
  // The player's taste from the thumbs (tasteProfile.ts): a second query brings the games most likely to please,
  // which the catalog order places where they rank.
  const taste = useMemo(() => buildTasteProfile(preferences, games), [preferences, games]);
  useEffect(() => publishTasteReadiness(taste.ready, Math.round(taste.certainty * 100)), [taste]);
  // Only with "personalized order" on (personalOrder.ts, next to the sort) and a ready profile.
  const personalOrder = usePersonalOrder();
  const tailoring = personalOrder.on && taste.ready;
  const tasteParams = useMemo(() => tailoring ? tasteQuery(taste, catalogBase, genreNames) : null, [tailoring, taste, catalogBase, genreNames]);
  const tasteCandidates = useCatalogQuery({ ...(tasteParams ?? {}), enabled: isCatalog && nativeCatalog && tasteParams !== null });
  // What the catalog showed last for this search, filters and sort: the games on screen keep their places when the
  // order adapts. A new search starts over.
  const lastCatalogRef = useRef<{ key: string; games: CatalogGame[] }>({ key: "", games: [] });

  const history = usePlayHistory();
  const members = useLibraryGames();
  const libraryIds = useMemo(() => new Set(members.map(game => game.app_id ?? game.id)), [members]);
  const hasInstalledGames = useMemo(() => games.some(game => { const state = gameStateManager.resolve(game.app_id ? effectiveDownloads[game.app_id] : undefined); return state.installed || state.prepared; }), [games, effectiveDownloads]);
  const hasFavoriteGames = useMemo(() => games.some(game => preferences[game.id] === 1), [games, preferences]);
  const isInstalledGame = useCallback((game: CatalogGame) => {
    const state = gameStateManager.resolve(game.app_id ? effectiveDownloads[game.app_id] : effectiveDownloads[game.id]);
    return state.installed || state.prepared;
  }, [effectiveDownloads]);
  const catalogCollection = useMemo(() => {
    if (libraryView === "catalog") {
      // The grid shows the database answer, even when it is empty. Only without the
      // database (browser preview, tests) or on a query error does it filter what is in memory.
      const memoryOnly = !nativeCatalog || Boolean(catalogQuery.error);
      const queried = memoryOnly ? filterLibraryGames(games, activeQuery, visibleFilters) : catalogQuery.items;
      // The catalog is for discovering: without a search it leaves out what is already installed (it is in the library).
      const sourceItems = activeQuery ? queried : queried.filter(game => !isInstalledGame(game));
      const candidates = tasteParams && !memoryOnly ? tasteCandidates.items.filter(game => activeQuery || !isInstalledGame(game)) : [];
      const key = JSON.stringify({ catalogBase, tailoring });
      const last = lastCatalogRef.current.key === key ? lastCatalogRef.current.games : [];
      const tailored = tailoring ? tailorCatalog(sourceItems, preferences, taste, { screen: last.slice(0, catalogScreenEnd(last)), candidates }) : sourceItems;
      lastCatalogRef.current = { key, games: tailored };
      const kept = new Set(tailored.map(game => game.id));
      const hiddenByTaste = tailoring ? sourceItems.filter(game => !kept.has(game.id)).length : 0;
      const items = downloadManager.pinGames(tailored, effectiveDownloads, trackedAppIds);
      const titles: Record<CatalogSort, string> = {
        "release-date": t("catalogTitleRelease"),
        "steam-popularity": t("catalogTitlePopularity"),
        "steam-review-score": t("catalogTitleScore"),
        "name": t("catalogTitleName"),
      };
      const descriptions: Record<CatalogSort, string> = {
        "release-date": t("catalogDescRelease"),
        "steam-popularity": t("catalogDescPopularity"),
        "steam-review-score": t("catalogDescScore"),
        "name": t("catalogDescName"),
      };
      return {
        id: "catalog" as const,
        title: titles[catalogSort] ?? t("catalogTitleDefault"),
        description: descriptions[catalogSort],
        games: items,
        total: memoryOnly ? sourceItems.length - hiddenByTaste : Math.max(0, catalogQuery.total - (queried.length - sourceItems.length) - hiddenByTaste),
        hiddenInstalled: queried.length - sourceItems.length,
      };
    }
    const nonCatalogGames = filterLibraryGames(games, activeQuery, visibleFilters);
    return buildLibraryCollection(
      downloadManager.pinGames(nonCatalogGames, effectiveDownloads, trackedAppIds),
      effectiveDownloads,
      preferences,
      history,
      libraryView,
      catalogSort,
      libraryIds,
    );
  }, [libraryView, catalogQuery.items, catalogQuery.total, catalogQuery.error, catalogSort, games, activeQuery, visibleFilters, effectiveDownloads, trackedAppIds, preferences, history, libraryIds, locale, isInstalledGame, taste, tasteParams, tasteCandidates.items, catalogBase, tailoring]);
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

  // The detail grows out of its card and folds back into it (docs/TAREA-interfaz-nueva.md T9).
  const detailSource = useCallback(() => {
    if (selectedGameIdResolved == null) return null;
    const card = document.querySelector<HTMLElement>(`[data-library-game-id="${selectedGameIdResolved}"]`);
    return card?.querySelector<HTMLElement>(".library-room-card-art") ?? card;
  }, [selectedGameIdResolved]);
  const detailMorphs = !auxiliarySurface && motionOk();
  useLayoutEffect(() => {
    const dialog = detailDialogRef.current, source = detailSource();
    if (!detailOpen || !detailMorphs || !dialog || !source) return;
    pushCards(source);
    const stop = morphOpen(dialog, source);
    // However the detail closes (its own close folds back into the card; big picture, an outside caller or a new
    // outside game just drop it), the card it came from shows again and the pushed cards go back to their places.
    return () => { stop(); restoreSource(source); releaseCards(source); };
  }, [detailOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const { closing: detailClosing, morphing: detailMorphing, close: closeGameDetail } = useOverlayClose(() => {
    setDetailOpen(false);
    setDetailMenu(null);
    setOwnDetailGame(null);
    onDetailClose?.();
    window.requestAnimationFrame(() => {
      const selected = selectedGameIdResolved == null ? null : gridRef.current?.querySelector<HTMLElement>(`[data-library-game-id="${selectedGameIdResolved}"]`);
      (selected ?? rootRef.current)?.focus({ preventScroll: true });
    });
  }, () => {
    const dialog = detailDialogRef.current, source = detailSource();
    if (!detailMorphs || !dialog) return null;
    releaseCards(source);
    return morphClose(dialog, source);
  });

  /** The run dialog is shown on its own: an open game detail closes first (its exit takes 180 ms), then the game starts. */
  const playGame = (game: CatalogGame) => {
    if (!detailOpen) return onPlay(game);
    closeGameDetail();
    window.setTimeout(() => void onPlay(game), 200);
  };

  // Big picture mode stays on the library with no detail open, whatever asks otherwise.
  useEffect(() => {
    if (!bigScreen) return;
    if (detailOpen) setDetailOpen(false);
    if (libraryView === "catalog") setLibraryView(getCatalogMode() === "digital" ? "library" : "installed");
  }, [bigScreen, detailOpen, libraryView]);

  // Tab (handled by LibraryInputController) flips between Catalog and Library.
  useEffect(() => {
    if (auxiliarySurface) return;
    const toggle = () => {
      if (bigPictureActive()) return;
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
    if (action.kind === "play") void playGame(selectedGame);
    else if (action.kind === "download") {
      // Without the download plugin the button in that place is "View on Steam".
      const node = actionRefs.current?.[index];
      if (node?.dataset.action === "steam") node.click();
      else void onDownload(selectedGame);
    }
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

  // Stable on purpose: every card receives it, and a new function each render defeated the cards' memo,
  // so a selection change re-rendered the whole grid.
  const displayGamesRef = useRef(displayGames);
  displayGamesRef.current = displayGames;
  const onSelectGame = useCallback((index: number, openDetails = true) => {
    const gameId = displayGamesRef.current[index]?.id ?? null;
    // An index outside the list must not clear the selection: that sent the grid back to the first game.
    if (gameId == null) return;
    setSelectedGameId(gameId);
    setDetailRequestedGameId(gameId);
    setFocusZone("grid");
    // Big picture mode never opens the game detail: a game is chosen and played, nothing else.
    if (openDetails && !bigPictureActive()) setDetailOpen(true);
  }, []);

  const dismissCompletion = async (play: boolean) => {
    const entry = completionQueue[0];
    if (!entry || completionHandlingRef.current.has(entry.record.job_id)) return;
    completionHandlingRef.current.add(entry.record.job_id);
    try {
      await acknowledgeDownloadCompletion(entry.record.job_id);
      setCompletionQueue((current) => current.filter((item) => item.record.job_id !== entry.record.job_id));
      if (play) void playGame(entry.game);
    } finally {
      completionHandlingRef.current.delete(entry.record.job_id);
    }
  };

  // A finished download is announced in the single notice: Play, or it closes by itself and counts as "not now".
  const completionJob = currentCompletion?.record.job_id;
  const dismissCompletionRef = useRef(dismissCompletion);
  dismissCompletionRef.current = dismissCompletion;
  useEffect(() => {
    if (!currentCompletion) return;
    let played = false;
    showNotice({
      game: noticeGame(currentCompletion.game), tone: "ok", timer: true,
      title: translate("dlsReady"), text: currentCompletion.game.name.replace(/\s+\+\s*$/, "").trim(),
      actions: [{ label: translate("playNow"), kind: "primary", run: () => { played = true; void dismissCompletionRef.current(true); } }],
      onDismiss: () => { if (!played) void dismissCompletionRef.current(false); },
    });
  }, [completionJob]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmCancellation = async () => {
    if (!cancelGame || cancelling) return;
    if (getCatalogMode() === "digital") {
      // The same call as the Cancel button of the downloads screen; the Steam path below is for the local catalog.
      setCancelling(true);
      setCancelError(null);
      try {
        await digitalDownloadService.cancel(cancelGame.app_id ?? cancelGame.id);
        setCancelGame(null);
      } catch (error) {
        setCancelError(error instanceof Error ? error.message : String(error));
      } finally {
        setCancelling(false);
      }
      return;
    }
    if (!cancelGame.app_id) return;
    const appId = cancelGame.app_id;
    const status = effectiveDownloads[appId];
    setCancelling(true);
    setCancelError(null);
    try {
      const result = await cancelManagedDownload(appId, status?.job_id);
      if (!result.supported) {
        setCancelError(result.message ?? t("cancelManagedBySteam"));
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
      onPreference={(value) => { rememberTasteGame(currentDetails ? { ...selectedGame, ...currentDetails } : selectedGame); onPreference(selectedGame.id, value); }}
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
      {!auxiliarySurface ? <ViewRail view={libraryView === "catalog" ? "catalog" : "library"} /> : null}
      {!auxiliarySurface ? <BigScreenControls footerTarget={actionsTarget} enabled={bigScreen} onToggle={() => void toggleBigScreen()} onDirection={markActivity} onAccept={gameId => { markActivity(); const game = games.find(item => item.id === gameId); if (game) void playGame(game); }} /> : null}
      {/* The empty welcome only covers the very first load: an empty library or search keeps the search bar,
          the catalog/library buttons and the zoom, so going back to the catalog is one click away. */}
      {displayGames.length > 0 || games.length > 0 || catalogQuery.loading || externalDetailGame || !loading ? (
        <>
          {auxiliarySurface && selectedGame ? detailPanel : null}
          {!auxiliarySurface && detailOpen && selectedGame ? <div className={`ga-detail-overlay${detailMorphs ? " is-morph" : ""}${detailClosing ? " is-closing" : ""}${detailMorphing ? " is-morphing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeGameDetail(); }}>
            <OverlayScreenDimmer panelRef={detailDialogRef} />
            <div ref={detailDialogRef} className="ga-detail-dialog" role="dialog" aria-modal="true" aria-label={t("detailsOfAria", { name: selectedGame.name })} tabIndex={-1}>
              <button ref={detailCloseRef} type="button" className="ga-detail-close" onClick={closeGameDetail} aria-label={t("uiCerrarDetalles")}><X size={23} strokeWidth={2.5} /></button>
              <button type="button" className="ga-detail-more" aria-label={t("moreOptionsForAria", { name: selectedGame.name })} aria-haspopup="menu" aria-expanded={Boolean(detailMenu)} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setDetailMenu(current => current ? null : { game: selectedGame, x: rect.left, y: rect.bottom + 6, status: selectedAppId ? effectiveDownloads[selectedAppId] : undefined }); }}><MoreHorizontal size={25} fill="currentColor" /></button>
              {detailPanel}
            </div>
            {detailMenu ? (getCatalogMode() === "digital"
              ? <DigitalGameContextMenu request={detailMenu} onClose={() => setDetailMenu(null)} onInstall={onDownload} onPlay={playGame} />
              : <GameStorageContextMenu request={detailMenu} onClose={() => setDetailMenu(null)} onInstall={onDownload} onPlay={playGame} />) : null}
          </div> : null}
          <RenderProbe id="CatalogPanel"><DownloadCatalogPanel onOpenGame={setOwnDetailGame} hiddenInstalled={"hiddenInstalled" in catalogCollection ? catalogCollection.hiddenInstalled : 0} isInstalled={isInstalledGame} toolbarTarget={auxiliarySurface ? null : toolbarTarget} actionsTarget={actionsTarget} games={displayGames} allGames={games} searchQuery={searchValue} onSearchQueryChange={onSearchQueryChange} searchFilters={searchFilters} onSearchFiltersChange={onSearchFiltersChange} section={catalogCollection} view={libraryView} onViewChange={setLibraryView} catalogSort={catalogSort} onCatalogSortChange={setCatalogSort} hasInstalled={hasInstalledGames} hasFavorites={hasFavoriteGames} catalogUnavailable={catalogUnavailable} catalogTotal={isCatalog ? catalogCollection.total : undefined} catalogLoading={isCatalog ? catalogQuery.loading : undefined} downloads={effectiveDownloads} selectedIndex={selectedIndex} gridRef={gridRef} pinnedAppIds={pinnedAppIds} preferences={preferences} history={history} onSelect={onSelectGame} onInstall={onDownload} onPlay={playGame} onPreference={onPreference} /></RenderProbe>
        </>
      ) : <EmptyLibraryContent gridRef={gridRef} loading={loading} />}
      <LibraryHint />
      {cancelGame ? <CancelDownloadDialog game={cancelGame} cancelling={cancelling} error={cancelError} onKeep={() => { if (!cancelling) setCancelGame(null); }} onConfirm={() => void confirmCancellation()} /> : null}
    </section>
  );
}

