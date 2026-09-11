import { buildLibrarySections } from "./librarySections";
import { usePlayHistory } from "./recentGames";
import { GAME_STORAGE_STATE_CHANGED_EVENT } from "./gameStorage";
import { findLibraryLetter } from "./librarySearch";
import { useDesktopWindowMaximized } from "./useDesktopWindowMaximized";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { loadDetails } from "./api";
import CancelDownloadDialog from "./CancelDownloadDialog";
import { DESKTOP_IDLE_TIMEOUT_MS, HIGH_FREQUENCY_ACTIVITY_EVENTS, HIGH_FREQUENCY_ACTIVITY_TRAILING_MS, IMMEDIATE_ACTIVITY_EVENTS } from "./desktopIdle";
import DownloadCatalogPanel from "./DownloadCatalogPanel";
import DownloadCompleteDialog from "./DownloadCompleteDialog";
import { cancelManagedDownload } from "./downloadCancellation";
import { acknowledgeDownloadCompletion, cancelDownloadLifecycle, pendingDownloadCompletions, recordDownloadCompletion, type DownloadJobRecord } from "./downloadLifecycle";
import { DOWNLOAD_REQUESTED_EVENT, DOWNLOAD_REQUEST_FAILED_EVENT, downloadManager } from "./downloadManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { buildActions, EmptyLibraryContent, FeaturePanel, handleActionKey, handleGridKey, LibraryHint, libraryRoomClass, selectedDownload, selectedHero, selectedPortraitHero, selectedWideArtworkSlides, selectedMovie, selectedSummary, selectedVideo, useCrossfadeArtwork } from "./LibraryRoomParts";
import { gameStateManager } from "./GameStateManager";
import type { DownloadMap, FocusZone } from "./LibraryRoomParts";
import { filterLibraryGames, LIBRARY_SEARCH_EVENT } from "./librarySearch";
import { calculateSelectionScrollTop, selectionItemTopInScrollContainer } from "./libraryNavigation";
import type { LibrarySearchEventDetail } from "./librarySearch";
import { steamDownloadStatus } from "./native";
import { playUiSound } from "./uiSounds";
import type { CatalogGame, GameDetails } from "./types";

interface LibraryRoomProps {
  games: CatalogGame[];
  downloads: DownloadMap;
  busy: boolean;
  onPlay: (game: CatalogGame) => void | Promise<void>;
  onDownload: (game: CatalogGame) => void | Promise<void>;
  onOpenDetails?: (game: CatalogGame) => void;
  preferences?: Record<number, 1 | -1>;
  onPreference?: (gameId: number, value: 1 | -1) => void;
  loading?: boolean;
}

type DownloadEventDetail = { appId?: number; error?: string };
type CompletionEntry = { record: DownloadJobRecord; game: CatalogGame };

export default function LibraryRoom({ games, downloads, busy, onPlay, onDownload, preferences = {}, onPreference = () => undefined, loading = false }: LibraryRoomProps) {
  const rootRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const showcaseEnteredRef = useRef(false);
  const requestStartedAtRef = useRef(new Map<number, number>());
  const activeSeenRef = useRef(new Set<number>());
  const missingPollsRef = useRef(new Map<number, number>());
  const previousDownloadStatesRef = useRef(new Map<number, string>());
  const completionHandlingRef = useRef(new Set<string>());
  const gamesByAppIdRef = useRef(new Map<number, CatalogGame>());

  const [selectedGameId, setSelectedGameId] = useState<number | null>(() => games[0]?.id ?? null);
  const [detailRequestedGameId, setDetailRequestedGameId] = useState<number | null>(null);
  const [focusZone, setFocusZone] = useState<FocusZone>("grid");
  const [actionIndex, setActionIndex] = useState(0);
  const [columns, setColumns] = useState(4);
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [detailsGameId, setDetailsGameId] = useState<number | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showcaseMode, setShowcaseMode] = useState(false);
  const [readyVideoSrc, setReadyVideoSrc] = useState<string | null>(null);
  const [videoMuted, setVideoMuted] = useState(true);
  const [videoVolume, setVideoVolume] = useState(0.68);
  const [managedDownloads, setManagedDownloads] = useState<DownloadMap>({});
  const [trackedAppIds, setTrackedAppIds] = useState<number[]>([]);
  const [completionQueue, setCompletionQueue] = useState<CompletionEntry[]>([]);
  const [cancelGame, setCancelGame] = useState<CatalogGame | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const isWindowMaximized = useDesktopWindowMaximized();
  const [artworkSlideIndex, setArtworkSlideIndex] = useState(0);

  gamesByAppIdRef.current = new Map(games.flatMap((game) => game.app_id ? [[game.app_id, game] as const] : []));

  const history = usePlayHistory();
  const effectiveDownloads = useMemo(() => ({ ...downloads, ...managedDownloads }), [downloads, managedDownloads]);
  const searchedGames = useMemo(() => {
    const filtered = filterLibraryGames(games, searchQuery);
    const rank = (game: CatalogGame) => {
      if (preferences[game.id] === -1) return 2;
      const status = game.app_id ? effectiveDownloads[game.app_id] : undefined;
      if (preferences[game.id] === 1 || gameStateManager.resolve(status).playButtonReady) return 0;
      return 1;
    };
    return [...filtered].sort((left, right) => rank(left) - rank(right));
  }, [games, searchQuery, preferences, effectiveDownloads]);
  const displayGames = useMemo(
    () => buildLibrarySections(downloadManager.pinGames(searchedGames, effectiveDownloads, trackedAppIds), effectiveDownloads, preferences, history).flatMap(section => section.games),
    [searchedGames, effectiveDownloads, trackedAppIds, preferences, history],
  );
  const selectedIndexRaw = displayGames.findIndex((game) => game.id === selectedGameId);
  const selectedIndex = selectedIndexRaw >= 0 ? selectedIndexRaw : 0;
  const selectedGame = selectedIndexRaw >= 0 ? displayGames[selectedIndexRaw] : displayGames[0];
  const selectedGameIdResolved = selectedGame?.id;
  const selectedAppId = selectedGame?.app_id;
  const accountCount = useMemo(() => new Set(games.flatMap((game) => [...(game.local_account_labels ?? []), ...(game.local_access_labels ?? [])])).size, [games]);
  const download = selectedDownload(selectedAppId, effectiveDownloads);
  // Selected-game probes and storage events replace stale local completion overlays.
  useEffect(() => {
    const changed = (event: Event) => {
      const status = (event as CustomEvent<{ status?: ManagedDownloadStatus }>).detail?.status;
      if (!status?.app_id) return;
      setManagedDownloads((current) => ({ ...current, [status.app_id]: status }));
    };
    window.addEventListener(GAME_STORAGE_STATE_CHANGED_EVENT, changed);
    return () => window.removeEventListener(GAME_STORAGE_STATE_CHANGED_EVENT, changed);
  }, []);
  useEffect(() => {
    if (!selectedAppId) return;
    let cancelled = false;
    let pending = false;
    const probe = async () => {
      if (pending) return;
      pending = true;
      try {
        const status = await steamDownloadStatus(selectedAppId);
        if (!cancelled && status.state !== "unknown") setManagedDownloads((current) => ({ ...current, [selectedAppId]: status }));
      } catch { /* Keep last known state until a successful probe. */ }
      finally { pending = false; }
    };
    void probe();
    const timer = window.setInterval(() => void probe(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
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
  const artwork = useCrossfadeArtwork(hero);
  const summary = selectedSummary(currentDetails);
  const actions = useMemo(() => buildActions(selectedGame, download, busy), [selectedGame, download, busy]);
  const currentCompletion = completionQueue[0];

  const enqueueCompletion = useCallback((record: DownloadJobRecord | null) => {
    if (!record) return;
    const game = gamesByAppIdRef.current.get(record.app_id);
    if (!game) return;
    setCompletionQueue((current) => current.some((entry) => entry.record.job_id === record.job_id) ? current : [...current, { record, game }]);
  }, []);

  const persistCompletion = useCallback(async (appId: number) => {
    try { enqueueCompletion(await recordDownloadCompletion(appId)); } catch { /* retry through pending scan */ }
  }, [enqueueCompletion]);

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

  useEffect(() => {
    const requested = (event: Event) => {
      const { appId } = (event as CustomEvent<DownloadEventDetail>).detail ?? {};
      if (!appId) return;
      requestStartedAtRef.current.set(appId, Date.now());
      missingPollsRef.current.set(appId, 0);
      activeSeenRef.current.delete(appId);
      setManagedDownloads((current) => ({ ...current, [appId]: downloadManager.requestedStatus(appId) }));
      setTrackedAppIds((current) => current.includes(appId) ? current : [...current, appId]);
    };
    const failed = (event: Event) => {
      const { appId } = (event as CustomEvent<DownloadEventDetail>).detail ?? {};
      if (!appId) return;
      void cancelDownloadLifecycle(appId).catch(() => undefined);
      requestStartedAtRef.current.delete(appId);
      missingPollsRef.current.delete(appId);
      activeSeenRef.current.delete(appId);
      setTrackedAppIds((current) => current.filter((id) => id !== appId));
      setManagedDownloads((current) => {
        const next = { ...current };
        delete next[appId];
        return next;
      });
    };
    window.addEventListener(DOWNLOAD_REQUESTED_EVENT, requested);
    window.addEventListener(DOWNLOAD_REQUEST_FAILED_EVENT, failed);
    return () => {
      window.removeEventListener(DOWNLOAD_REQUESTED_EVENT, requested);
      window.removeEventListener(DOWNLOAD_REQUEST_FAILED_EVENT, failed);
    };
  }, []);

  useEffect(() => {
    const discovered = Object.values(downloads).filter((status) => downloadManager.isTracked(status)).map((status) => status.app_id);
    if (!discovered.length) return;
    const now = Date.now();
    for (const appId of discovered) {
      if (!requestStartedAtRef.current.has(appId)) requestStartedAtRef.current.set(appId, now);
      activeSeenRef.current.add(appId);
    }
    setTrackedAppIds((current) => [...current, ...discovered.filter((appId) => !current.includes(appId))]);
  }, [downloads]);

  useEffect(() => {
    if (!trackedAppIds.length) return;
    let cancelled = false;
    let timer: number | null = null;

    const release = (appId: number) => {
      requestStartedAtRef.current.delete(appId);
      activeSeenRef.current.delete(appId);
      missingPollsRef.current.delete(appId);
      setTrackedAppIds((current) => current.filter((id) => id !== appId));
    };

    const probeOne = async (appId: number) => {
      const status = await steamDownloadStatus(appId) as ManagedDownloadStatus;
      if (cancelled) return;
      if (gameStateManager.isDownloadComplete(status)) {
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        release(appId);
        await persistCompletion(appId);
        return;
      }
      if (status.state === "cancelled") {
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        release(appId);
        await cancelDownloadLifecycle(appId).catch(() => undefined);
        return;
      }
      if (downloadManager.isTracked(status) && status.state !== "requested") {
        activeSeenRef.current.add(appId);
        missingPollsRef.current.set(appId, 0);
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        return;
      }
      if (status.state !== "not-installed") return;
      if (status.error) {
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        release(appId);
        await cancelDownloadLifecycle(appId).catch(() => undefined);
        return;
      }
      const missingPolls = (missingPollsRef.current.get(appId) ?? 0) + 1;
      missingPollsRef.current.set(appId, missingPolls);
      const elapsed = Date.now() - (requestStartedAtRef.current.get(appId) ?? Date.now());
      if (!downloadManager.shouldReleaseMissing(status, activeSeenRef.current.has(appId), missingPolls, elapsed)) return;
      setManagedDownloads((current) => ({ ...current, [appId]: status }));
      release(appId);
    };

    const probe = async () => {
      await Promise.all(trackedAppIds.map((appId) => probeOne(appId).catch(() => undefined)));
      if (!cancelled) timer = window.setTimeout(() => void probe(), 2500);
    };
    void probe();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [trackedAppIds, persistCompletion]);

  useEffect(() => {
    for (const [rawAppId, status] of Object.entries(effectiveDownloads)) {
      const appId = Number(rawAppId);
      const previousState = previousDownloadStatesRef.current.get(appId);
      if (downloadManager.didJustComplete(previousState, status)) void persistCompletion(appId);
      previousDownloadStatesRef.current.set(appId, status.state);
    }
  }, [effectiveDownloads, persistCompletion]);

  useEffect(() => {
    if (!games.length) return;
    let cancelled = false;
    let timer: number | null = null;
    const refresh = async () => {
      try {
        const records = await pendingDownloadCompletions();
        if (!cancelled) records.forEach(enqueueCompletion);
      } catch { /* runtime store can retry */ }
      if (!cancelled) timer = window.setTimeout(() => void refresh(), 4000);
    };
    void refresh();
    return () => { cancelled = true; if (timer !== null) window.clearTimeout(timer); };
  }, [games.length, enqueueCompletion]);

  const markActivity = useCallback(() => {
    setShowcaseMode(false);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
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
      const width = first.getBoundingClientRect().width;
      const shelf = first.closest<HTMLElement>(".library-section-grid") ?? grid;
      const gap = Number.parseFloat(getComputedStyle(shelf).columnGap || "16") || 16;
      setColumns(Math.max(1, Math.round((shelf.clientWidth + gap) / (width + gap))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    measure();
    return () => observer.disconnect();
  }, [displayGames.length]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    const grid = gridRef.current;
    const card = grid?.querySelector<HTMLElement>(".library-room-card.is-selected");
    if (!grid || !card) return;

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
    if (Math.abs(nextTop - grid.scrollTop) > 1) {
      grid.scrollTo({ top: nextTop, behavior: "auto" });
    }
  }, [selectedIndex]);

  useEffect(() => {
    const shouldLoadDetails = detailRequestedGameId === selectedGameIdResolved;
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
  }, [selectedGameIdResolved, detailRequestedGameId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A changed selection or primary action resets keyboard action focus.
  useEffect(() => { setActionIndex(0); }, [selectedGameIdResolved, actions[0]?.kind]);

  const moveGrid = (delta: number) => {
    const visibleIds = Array.from(gridRef.current?.querySelectorAll<HTMLElement>(".library-room-card") ?? []).map(card => Number(card.dataset.libraryGameId));
    const position = visibleIds.indexOf(selectedGameIdResolved ?? -1);
    const nextId = visibleIds[Math.max(0, Math.min(visibleIds.length - 1, position + delta))];
    const next = displayGames.findIndex(game => game.id === nextId);
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
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]"))) return;
    if (event.target instanceof HTMLElement && event.target.closest(".library-section-heading button, .library-section-pages button, .library-catalog-toolbar button")) return;
    markActivity();
    const letterIndex = findLibraryLetter(displayGames, event.key, selectedIndex);
    if (letterIndex >= 0) {
      event.preventDefault();
      onSelectGame(letterIndex);
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
    const context = { actionIndex, actionRefs, setActionIndex, returnToGrid, activateAction };
    const gridContext = { selectedIndex, columns, enterActions, moveGrid };
    const handled = focusZone === "actions" ? handleActionKey(event.key.toLowerCase(), context) : handleGridKey(event.key.toLowerCase(), gridContext);
    if (handled) event.preventDefault();
  };

  const onSelectGame = (index: number) => {
    const gameId = displayGames[index]?.id ?? null;
    setSelectedGameId(gameId);
    setDetailRequestedGameId(gameId);
    setFocusZone("grid");
    rootRef.current?.focus({ preventScroll: true });
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
    <section ref={rootRef} className={rootClass} tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={markActivity} aria-label="Biblioteca">
      {selectedGame ? (
        <>
          {detailPanel}
          <DownloadCatalogPanel games={displayGames} downloads={effectiveDownloads} accountCount={accountCount} selectedIndex={selectedIndex} gridRef={gridRef} pinnedAppIds={pinnedAppIds} preferences={preferences} history={history} onSelect={onSelectGame} onPlay={onPlay} />
        </>
      ) : <EmptyLibraryContent gridRef={gridRef} loading={loading} />}
      <LibraryHint />
      {currentCompletion ? <DownloadCompleteDialog game={currentCompletion.game} busy={busy} onPlay={() => void dismissCompletion(true)} onClose={() => void dismissCompletion(false)} /> : null}
      {cancelGame ? <CancelDownloadDialog game={cancelGame} cancelling={cancelling} error={cancelError} onKeep={() => { if (!cancelling) setCancelGame(null); }} onConfirm={() => void confirmCancellation()} /> : null}
    </section>
  );
}
