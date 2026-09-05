import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MoreHorizontal, Search, Tv2, X } from "lucide-react";

import { loadDetails } from "./api";
import CancelDownloadDialog from "./CancelDownloadDialog";
import { DESKTOP_IDLE_TIMEOUT_MS, HIGH_FREQUENCY_ACTIVITY_EVENTS, HIGH_FREQUENCY_ACTIVITY_TRAILING_MS, IMMEDIATE_ACTIVITY_EVENTS } from "./desktopIdle";
import DownloadCatalogPanel from "./DownloadCatalogPanel";
import DownloadCompleteDialog from "./DownloadCompleteDialog";
import { cancelManagedDownload } from "./downloadCancellation";
import {
  acknowledgeDownloadCompletion,
  cancelDownloadLifecycle,
  pendingDownloadCompletions,
  recordDownloadCompletion,
  type DownloadJobRecord,
} from "./downloadLifecycle";
import {
  DOWNLOAD_REQUESTED_EVENT,
  DOWNLOAD_REQUEST_FAILED_EVENT,
  didDownloadJustComplete,
  isTrackedDownload,
  pinDownloadingGames,
  requestedDownloadStatus,
  shouldReleaseMissingDownload,
} from "./downloadManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import {
  buildActions,
  EmptyLibraryContent,
  FeaturePanel,
  handleActionKey,
  handleGridKey,
  isActiveDownload,
  isInstalled,
  LibraryHint,
  libraryRoomClass,
  selectedDownload,
  selectedHero,
  selectedMovie,
  selectedSummary,
  selectedVideo,
  useCrossfadeArtwork,
} from "./LibraryRoomParts";
import type { DownloadMap, FocusZone } from "./LibraryRoomParts";
import { filterLibraryGames, LIBRARY_SEARCH_EVENT } from "./librarySearch";
import { calculateSelectionScrollTop } from "./libraryNavigation";
import type { LibrarySearchEventDetail } from "./librarySearch";
import { providerDownloadEstimate, steamDownloadStatus } from "./native";
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
type CefWindow = Window & {
  sendIpcMessage?: (message: string) => void;
  onIpcMessage?: (message: string) => void;
};

function formatBytes(value: number | null | undefined) {
  if (value == null || value < 0) return "No informado por Steam";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function estimateStatus(appId: number, bytesTotal: number): ManagedDownloadStatus {
  return {
    app_id: appId,
    state: "not-installed",
    progress: null,
    bytes_downloaded: null,
    bytes_total: bytesTotal,
    installed: false,
  };
}

export default function LibraryRoom({ games, downloads, busy, onPlay, onDownload, preferences = {}, onPreference = () => undefined, loading = false }: LibraryRoomProps) {
  const surfaceMode = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("surface");
  const isTabletSurface = surfaceMode === "tablet";
  const isDisplaySurface = surfaceMode === "display";
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

  const [selectedGameId, setSelectedGameId] = useState<number | null>(() => isTabletSurface ? null : (games[0]?.id ?? null));
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
  const [estimatesByAppId, setEstimatesByAppId] = useState<Record<number, number>>({});
  const [trackedAppIds, setTrackedAppIds] = useState<number[]>([]);
  const [completionQueue, setCompletionQueue] = useState<CompletionEntry[]>([]);
  const [cancelGame, setCancelGame] = useState<CatalogGame | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tabletDetailsOpen, setTabletDetailsOpen] = useState(false);
  const [displayPinned, setDisplayPinned] = useState(false);

  gamesByAppIdRef.current = new Map(games.flatMap((game) => game.app_id ? [[game.app_id, game] as const] : []));

  const effectiveDownloads = useMemo(() => ({ ...downloads, ...managedDownloads }), [downloads, managedDownloads]);
  const searchedGames = useMemo(() => {
    const filtered = filterLibraryGames(games, searchQuery);
    const rank = (game: CatalogGame) => {
      if (preferences[game.id] === -1) return 2;
      const status = game.app_id ? effectiveDownloads[game.app_id] : undefined;
      if (preferences[game.id] === 1 || isInstalled(status)) return 0;
      return 1;
    };
    return [...filtered].sort((left, right) => rank(left) - rank(right));
  }, [games, searchQuery, preferences, effectiveDownloads]);
  const displayGames = useMemo(
    () => pinDownloadingGames(searchedGames, effectiveDownloads, trackedAppIds),
    [searchedGames, effectiveDownloads, trackedAppIds],
  );
  const selectedIndexRaw = displayGames.findIndex((game) => game.id === selectedGameId);
  const selectedIndex = selectedIndexRaw >= 0 ? selectedIndexRaw : (isTabletSurface ? -1 : 0);
  const selectedGame = selectedIndexRaw >= 0 ? displayGames[selectedIndexRaw] : (isTabletSurface ? undefined : displayGames[0]);
  const selectedGameIdResolved = selectedGame?.id;
  const selectedAppId = selectedGame?.app_id;
  const accountCount = useMemo(() => new Set(games.flatMap((game) => [...(game.local_account_labels ?? []), ...(game.local_access_labels ?? [])])).size, [games]);
  const download = selectedDownload(selectedAppId, effectiveDownloads);
  const installed = isInstalled(download);
  const activeDownload = isActiveDownload(download);
  const estimateBytes = selectedAppId ? estimatesByAppId[selectedAppId] : undefined;
  const detailDownload = useMemo<ManagedDownloadStatus | undefined>(() => {
    if (!selectedAppId || estimateBytes == null || download?.bytes_total != null) return download;
    return download ? { ...download, bytes_total: estimateBytes } : estimateStatus(selectedAppId, estimateBytes);
  }, [download, estimateBytes, selectedAppId]);
  const currentDetails = detailsGameId === selectedGameIdResolved ? details : null;
  const hero = isTabletSurface ? undefined : selectedHero(currentDetails, selectedGame);
  const movie = isTabletSurface ? undefined : selectedMovie(currentDetails);
  const videoSrc = isTabletSurface ? undefined : selectedVideo(movie);
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
    if (isTabletSurface) {
      if (selectedGameId != null) setSelectedGameId(null);
      return;
    }
    setSelectedGameId(displayGames[0].id);
  }, [displayGames, selectedGameId, isTabletSurface]);

  useEffect(() => {
    if (!isTabletSurface) return;
    const payload = selectedGame && selectedGameIdResolved != null
      ? JSON.stringify({ type: "game-selection", gameId: selectedGameIdResolved, appId: selectedGame.app_id ?? null, name: selectedGame.name })
      : JSON.stringify({ type: "game-selection-clear" });
    (window as CefWindow).sendIpcMessage?.(payload);
  }, [isTabletSurface, selectedGameIdResolved, selectedGame]);

  useEffect(() => {
    if (!isDisplaySurface) return;
    const cefWindow = window as CefWindow;
    const previous = cefWindow.onIpcMessage;
    cefWindow.onIpcMessage = (message: string) => {
      try {
        const payload = JSON.parse(message) as { type?: string; gameId?: number };
        if (payload.type === "game-selection" && Number.isFinite(payload.gameId)) {
          setDisplayPinned(true);
          setSelectedGameId(payload.gameId ?? null);
          setDetailRequestedGameId(payload.gameId ?? null);
        } else if (payload.type === "game-selection-clear") {
          setDisplayPinned(false);
        }
      } catch { /* ignore unrelated CEF IPC */ }
    };
    return () => { cefWindow.onIpcMessage = previous; };
  }, [isDisplaySurface]);

  useEffect(() => {
    if (!isDisplaySurface || displayPinned || displayGames.length < 2 || selectedGameIdResolved == null) return;
    const holdMs = videoSrc ? 45_000 : 18_000;
    const timer = window.setTimeout(() => {
      const current = Math.max(0, displayGames.findIndex((game) => game.id === selectedGameIdResolved));
      const next = (current + 1) % displayGames.length;
      setSelectedGameId(displayGames[next]?.id ?? displayGames[0]?.id ?? null);
    }, holdMs);
    return () => window.clearTimeout(timer);
  }, [isDisplaySurface, displayPinned, displayGames, selectedGameIdResolved, videoSrc]);

  useEffect(() => {
    const requested = (event: Event) => {
      const { appId } = (event as CustomEvent<DownloadEventDetail>).detail ?? {};
      if (!appId) return;
      requestStartedAtRef.current.set(appId, Date.now());
      missingPollsRef.current.set(appId, 0);
      activeSeenRef.current.delete(appId);
      setManagedDownloads((current) => ({ ...current, [appId]: requestedDownloadStatus(appId) }));
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
    const discovered = Object.values(downloads).filter((status) => isTrackedDownload(status)).map((status) => status.app_id);
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
      if (status.installed || status.state === "installed") {
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
      if (isTrackedDownload(status) && status.state !== "requested") {
        activeSeenRef.current.add(appId);
        missingPollsRef.current.set(appId, 0);
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        return;
      }
      if (status.state !== "not-installed") return;
      const missingPolls = (missingPollsRef.current.get(appId) ?? 0) + 1;
      missingPollsRef.current.set(appId, missingPolls);
      const elapsed = Date.now() - (requestStartedAtRef.current.get(appId) ?? Date.now());
      if (!shouldReleaseMissingDownload(status, activeSeenRef.current.has(appId), missingPolls, elapsed)) return;
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
      if (didDownloadJustComplete(previousState, status)) void persistCompletion(appId);
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
    if (isTabletSurface || isDisplaySurface) return;
    idleTimerRef.current = window.setTimeout(() => {
      setFocusZone("grid");
      setShowcaseMode(true);
    }, DESKTOP_IDLE_TIMEOUT_MS);
  }, [isTabletSurface, isDisplaySurface]);

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
      const gap = Number.parseFloat(getComputedStyle(grid).columnGap || "16") || 16;
      setColumns(Math.max(1, Math.round((grid.clientWidth + gap) / (width + gap))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    measure();
    return () => observer.disconnect();
  }, [displayGames.length]);

  useEffect(() => {
    if (!isTabletSurface || selectedIndex < 0) return;
    const grid = gridRef.current;
    const card = grid?.querySelector<HTMLElement>(".library-room-card.is-selected");
    if (!grid || !card) return;
    const nextTop = calculateSelectionScrollTop({ scrollTop: grid.scrollTop, viewportHeight: grid.clientHeight, itemTop: card.offsetTop, itemHeight: card.offsetHeight, padding: 8 });
    if (Math.abs(nextTop - grid.scrollTop) > 1) grid.scrollTo({ top: nextTop, behavior: "auto" });
  }, [isTabletSurface, selectedIndex]);

  useEffect(() => {
    const shouldLoadDetails = (!isTabletSurface || tabletDetailsOpen) && detailRequestedGameId === selectedGameIdResolved;
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
  }, [selectedGameIdResolved, isTabletSurface, tabletDetailsOpen, detailRequestedGameId]);

  useEffect(() => {
    if (detailRequestedGameId !== selectedGameIdResolved || !selectedAppId || download?.bytes_total != null || estimatesByAppId[selectedAppId] != null || activeDownload || installed) return;
    const appId = selectedAppId;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void providerDownloadEstimate(appId).then((status) => {
        if (cancelled || status?.bytes_total == null) return;
        setEstimatesByAppId((current) => ({ ...current, [appId]: status.bytes_total! }));
      });
    }, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [selectedAppId, download?.bytes_total, activeDownload, installed, detailRequestedGameId, selectedGameIdResolved, estimatesByAppId]);

  useEffect(() => { if (isTabletSurface) setTabletDetailsOpen(false); }, [isTabletSurface]);
  useEffect(() => { setActionIndex(0); }, [selectedGameIdResolved, actions[0]?.kind]);

  const moveGrid = (delta: number) => {
    const next = Math.max(0, Math.min(displayGames.length - 1, selectedIndex + delta));
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
    markActivity();
    if (!selectedGame) {
      const key = event.key.toLowerCase();
      if (displayGames.length && ["enter", "a", "d", "w", "s", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
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
    setTabletDetailsOpen(false);
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

  const surfaceClass = isTabletSurface ? "surface-tablet" : isDisplaySurface ? "surface-display" : "";
  const rootClass = `${libraryRoomClass(focusZone, showcaseMode, Boolean(selectedGame))} ${surfaceClass}`.trim();
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
      showcaseMode={isDisplaySurface ? !displayPinned : showcaseMode}
      summary={summary}
      loadingDetails={loadingDetails}
      details={currentDetails}
      download={detailDownload}
      preference={preferences[selectedGame.id]}
      onPreference={(value) => onPreference(selectedGame.id, value)}
      actions={actions}
      focusZone={isDisplaySurface ? "grid" : focusZone}
      actionIndex={actionIndex}
      actionRefs={actionRefs}
      setFocusZone={setFocusZone}
      setActionIndex={setActionIndex}
      onAction={onAction}
    />
  ) : null;

  if (isDisplaySurface) {
    return (
      <section className={rootClass} aria-label="Pantalla principal de biblioteca">
        {detailPanel ?? <div className="library-display-empty">Seleccioná un juego desde la tablet</div>}
      </section>
    );
  }

  if (isTabletSurface) {
    const primaryAction = selectedGame ? actions[0] : undefined;
    const accountLabel = selectedGame?.local_account_labels?.length ? selectedGame.local_account_labels.join(", ") : selectedGame?.local_primary_account_label ?? "No informado";
    const accessLabel = selectedGame?.local_access_labels?.length ? selectedGame.local_access_labels.join(", ") : "No informado";
    return (
      <section ref={rootRef} className={rootClass} tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={markActivity} aria-label="Control de biblioteca">
        <header className="library-phone-top">
          <label className="library-phone-search" onKeyDown={(event) => event.stopPropagation()}>
            <Search size={18} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Buscar juegos" autoComplete="off" aria-label="Buscar en tu biblioteca" />
            {searchQuery ? <button type="button" onClick={() => setSearchQuery("")} aria-label="Limpiar búsqueda"><X size={16} /></button> : null}
          </label>
          {selectedGame ? (
            <div className="library-phone-selection">
              <div className="library-phone-selection-copy">
                <span>{installed ? "INSTALADO" : activeDownload ? `DESCARGANDO ${Math.round(download?.progress ?? 0)}%` : "SELECCIONADO"}</span>
                <strong>{selectedGame.name}</strong>
              </div>
              <button type="button" className="library-phone-release" title="Volver al modo vitrina de la TV" aria-label="Volver al modo vitrina de la TV" onClick={() => { setSelectedGameId(null); setTabletDetailsOpen(false); }}><X size={16} /></button>
              <div className="library-phone-actions">
                {primaryAction ? <button type="button" className="library-phone-primary" disabled={primaryAction.disabled} onClick={() => onAction(0)}>{primaryAction.icon}<strong>{primaryAction.label}</strong></button> : null}
                <button type="button" className="library-phone-more" aria-label="Administrar juego" title="Administrar juego" onClick={() => { setDetailRequestedGameId(selectedGame.id); setTabletDetailsOpen(true); }}><MoreHorizontal size={22} /></button>
              </div>
            </div>
          ) : <div className="library-phone-showcase"><Tv2 size={18} /><span>TV en modo vitrina</span></div>}
        </header>

        <DownloadCatalogPanel games={displayGames} downloads={effectiveDownloads} accountCount={accountCount} selectedIndex={selectedIndex} gridRef={gridRef} pinnedAppIds={pinnedAppIds} onSelect={onSelectGame} onPlay={onPlay} />

        {tabletDetailsOpen && selectedGame ? (
          <aside className="library-phone-details" onPointerDown={(event) => event.stopPropagation()}>
            <header><div><span className="eyebrow">ADMINISTRAR</span><h2>{selectedGame.name}</h2></div><button type="button" onClick={() => setTabletDetailsOpen(false)} aria-label="Cerrar"><X size={18} /></button></header>
            <div className="library-phone-details-scroll">
              <dl className="library-phone-facts">
                <div><dt>Estado</dt><dd>{installed ? "Instalado" : download?.state === "cancelling" ? "Cancelando" : activeDownload ? `Descargando ${Math.round(download?.progress ?? 0)}%` : "No instalado"}</dd></div>
                <div><dt>Espacio</dt><dd>{formatBytes(detailDownload?.bytes_total)}</dd></div>
                <div><dt>Cuenta Steam</dt><dd>{accountLabel}</dd></div>
                <div><dt>Acceso</dt><dd>{accessLabel}</dd></div>
                <div><dt>Steam AppID</dt><dd>{selectedGame.app_id ?? "—"}</dd></div>
                <div><dt>Copias</dt><dd>{selectedGame.copies_available} / {selectedGame.copies_total} disponibles</dd></div>
                <div><dt>Inventario</dt><dd>{selectedGame.local_inventory_verified ? "Verificado" : "Sin verificar"}</dd></div>
              </dl>
              {loadingDetails ? <span className="library-room-loading">Cargando datos…</span> : null}
              {details?.steam?.short_description ? <p className="library-phone-description">{details.steam.short_description}</p> : null}
              {details?.steam?.developers?.length ? <p className="library-phone-meta"><strong>Desarrollador</strong>{details.steam.developers.join(", ")}</p> : null}
              {details?.steam?.publishers?.length ? <p className="library-phone-meta"><strong>Publisher</strong>{details.steam.publishers.join(", ")}</p> : null}
              {details?.steam?.genres?.length ? <p className="library-phone-meta"><strong>Géneros</strong>{details.steam.genres.join(" · ")}</p> : null}
              {details?.steam?.screenshots?.length ? <div className="library-phone-screenshots">{details.steam.screenshots.slice(0, 6).map((shot, index) => shot.thumbnail || shot.full ? <img key={shot.id ?? index} src={shot.thumbnail ?? shot.full} alt="" loading="lazy" draggable={false} /> : null)}</div> : null}
            </div>
          </aside>
        ) : null}

        {currentCompletion ? <DownloadCompleteDialog game={currentCompletion.game} busy={busy} onPlay={() => void dismissCompletion(true)} onClose={() => void dismissCompletion(false)} /> : null}
        {cancelGame ? <CancelDownloadDialog game={cancelGame} cancelling={cancelling} error={cancelError} onKeep={() => { if (!cancelling) setCancelGame(null); }} onConfirm={() => void confirmCancellation()} /> : null}
      </section>
    );
  }

  return (
    <section ref={rootRef} className={rootClass} tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={markActivity} aria-label="Biblioteca">
      {selectedGame ? (
        <>
          {detailPanel}
          <DownloadCatalogPanel games={displayGames} downloads={effectiveDownloads} accountCount={accountCount} selectedIndex={selectedIndex} gridRef={gridRef} pinnedAppIds={pinnedAppIds} onSelect={onSelectGame} onPlay={onPlay} />
        </>
      ) : <EmptyLibraryContent gridRef={gridRef} loading={loading} />}
      <LibraryHint />
      {currentCompletion ? <DownloadCompleteDialog game={currentCompletion.game} busy={busy} onPlay={() => void dismissCompletion(true)} onClose={() => void dismissCompletion(false)} /> : null}
      {cancelGame ? <CancelDownloadDialog game={cancelGame} cancelling={cancelling} error={cancelError} onKeep={() => { if (!cancelling) setCancelGame(null); }} onConfirm={() => void confirmCancellation()} /> : null}
    </section>
  );
}
