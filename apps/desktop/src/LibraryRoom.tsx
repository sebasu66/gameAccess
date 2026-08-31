import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { loadDetails } from "./api";
import DownloadCatalogPanel from "./DownloadCatalogPanel";
import DownloadCompleteDialog from "./DownloadCompleteDialog";
import {
  DOWNLOAD_REQUESTED_EVENT,
  DOWNLOAD_REQUEST_FAILED_EVENT,
  isTrackedDownload,
  pinDownloadingGames,
  requestedDownloadStatus,
  shouldReleaseMissingDownload,
} from "./downloadManager";
import {
  buildActions,
  EmptyLibraryContent,
  FeaturePanel,
  firstPresent,
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
  onOpenDetails: (game: CatalogGame) => void;
  loading?: boolean;
}

type DownloadEventDetail = { appId?: number; error?: string };

export default function LibraryRoom({ games, downloads, busy, onPlay, onDownload, onOpenDetails, loading = false }: LibraryRoomProps) {
  const rootRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const showcaseEnteredRef = useRef(false);
  const requestStartedAtRef = useRef(new Map<number, number>());
  const activeSeenRef = useRef(new Set<number>());
  const missingPollsRef = useRef(new Map<number, number>());

  const [selectedGameId, setSelectedGameId] = useState<number | null>(games[0]?.id ?? null);
  const [focusZone, setFocusZone] = useState<FocusZone>("grid");
  const [actionIndex, setActionIndex] = useState(0);
  const [columns, setColumns] = useState(4);
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showcaseMode, setShowcaseMode] = useState(false);
  const [readyVideoSrc, setReadyVideoSrc] = useState<string | null>(null);
  const [videoMuted, setVideoMuted] = useState(true);
  const [videoVolume, setVideoVolume] = useState(0.68);
  const [managedDownloads, setManagedDownloads] = useState<DownloadMap>({});
  const [trackedAppIds, setTrackedAppIds] = useState<number[]>([]);
  const [completedGame, setCompletedGame] = useState<CatalogGame | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const effectiveDownloads = useMemo(() => ({ ...downloads, ...managedDownloads }), [downloads, managedDownloads]);
  const searchedGames = useMemo(() => filterLibraryGames(games, searchQuery), [games, searchQuery]);
  const displayGames = useMemo(
    () => pinDownloadingGames(searchedGames, effectiveDownloads, trackedAppIds),
    [searchedGames, effectiveDownloads, trackedAppIds],
  );
  const selectedIndexRaw = displayGames.findIndex((game) => game.id === selectedGameId);
  const selectedIndex = selectedIndexRaw >= 0 ? selectedIndexRaw : 0;
  const selectedGame = firstPresent(displayGames[selectedIndex], displayGames[0]);
  const selectedGameIdResolved = selectedGame?.id;
  const selectedAppId = selectedGame?.app_id;
  const accountCount = useMemo(() => new Set(games.flatMap((game) => game.local_account_labels ?? [])).size, [games]);
  const download = selectedDownload(selectedAppId, effectiveDownloads);
  const installed = isInstalled(download);
  const activeDownload = isActiveDownload(download);
  const hero = selectedHero(details, selectedGame);
  const movie = selectedMovie(details);
  const videoSrc = selectedVideo(movie);
  const artwork = useCrossfadeArtwork(hero);
  const summary = selectedSummary(details);
  const actions = useMemo(
    () => buildActions(selectedGame, installed, activeDownload, busy, download?.progress),
    [selectedGame, installed, activeDownload, busy, download?.progress],
  );

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
    if (!displayGames.some((game) => game.id === selectedGameId)) setSelectedGameId(displayGames[0].id);
  }, [displayGames, selectedGameId]);

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
    const discovered = Object.values(downloads)
      .filter((status) => isTrackedDownload(status))
      .map((status) => status.app_id);
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

    const release = (appId: number) => {
      requestStartedAtRef.current.delete(appId);
      activeSeenRef.current.delete(appId);
      missingPollsRef.current.delete(appId);
      setTrackedAppIds((current) => current.filter((id) => id !== appId));
    };

    const probeOne = async (appId: number) => {
      const status = await steamDownloadStatus(appId);
      if (cancelled) return;
      if (status.installed || status.state === "installed") {
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        const game = games.find((item) => item.app_id === appId);
        release(appId);
        if (game) setCompletedGame(game);
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

    const probe = () => {
      void Promise.all(trackedAppIds.map((appId) => probeOne(appId).catch(() => undefined)));
    };
    probe();
    const timer = window.setInterval(probe, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [trackedAppIds, games]);

  const markActivity = useCallback(() => {
    setShowcaseMode(false);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setFocusZone("grid");
      setShowcaseMode(true);
    }, 30_000);
  }, []);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    markActivity();
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    };
  }, [markActivity]);

  useEffect(() => {
    if (!showcaseMode) {
      showcaseEnteredRef.current = false;
      return;
    }
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
    if (selectedGameIdResolved == null) return;
    let cancelled = false;
    setDetails(null);
    setLoadingDetails(true);
    loadDetails(selectedGameIdResolved)
      .then((value) => { if (!cancelled) setDetails(value); })
      .catch(() => { if (!cancelled) setDetails(null); })
      .finally(() => { if (!cancelled) setLoadingDetails(false); });
    return () => { cancelled = true; };
  }, [selectedGameIdResolved]);

  useEffect(() => {
    if (selectedGameIdResolved == null) return;
    if (installed) setActionIndex(0);
    else if (selectedAppId) setActionIndex(1);
    else setActionIndex(2);
  }, [selectedGameIdResolved, selectedAppId, installed]);

  const moveGrid = (delta: number) => {
    const next = Math.max(0, Math.min(displayGames.length - 1, selectedIndex + delta));
    if (next === selectedIndex) return;
    playUiSound("move");
    setSelectedGameId(displayGames[next]?.id ?? null);
  };

  const enterActions = () => {
    playUiSound("activate");
    setFocusZone("actions");
    window.requestAnimationFrame(() => actionRefs.current[actionIndex]?.focus({ preventScroll: true }));
  };

  const returnToGrid = () => {
    setFocusZone("grid");
    rootRef.current?.focus({ preventScroll: true });
  };

  const startVideoPastIntro = (video: HTMLVideoElement) => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const gameplayStart = duration > 0 ? Math.min(Math.max(7, duration * 0.14), Math.max(0, duration - 4)) : 7;
    try {
      video.currentTime = gameplayStart;
    } catch {
      // Metadata can race on WebView2.
    }
    video.volume = videoVolume;
    video.muted = videoMuted;
    void video.play().catch(() => undefined);
  };

  const handleVideoReady = (video: HTMLVideoElement) => {
    setReadyVideoSrc(videoSrc ?? null);
    void video.play().catch(() => undefined);
  };

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

  const activateAction = () => {
    if (!selectedGame) return;
    playUiSound("activate");
    if (actionIndex === 0 && installed && !busy && selectedGame.copies_available > 0) void onPlay(selectedGame);
    if (actionIndex === 1 && selectedGame.app_id && !installed && !activeDownload) void onDownload(selectedGame);
    if (actionIndex === 2) onOpenDetails(selectedGame);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    markActivity();
    if (!selectedGame) return;
    const context = { actionIndex, actionRefs, setActionIndex, returnToGrid, activateAction };
    const gridContext = { selectedIndex, columns, enterActions, moveGrid };
    const handled = focusZone === "actions"
      ? handleActionKey(event.key.toLowerCase(), context)
      : handleGridKey(event.key.toLowerCase(), gridContext);
    if (handled) event.preventDefault();
  };

  const onAction = (index: number) => {
    setActionIndex(index);
    const action = actions[index];
    if (!action || action.disabled || !selectedGame) return;
    playUiSound("activate");
    if (action.kind === "play") void onPlay(selectedGame);
    else if (action.kind === "download") void onDownload(selectedGame);
    else onOpenDetails(selectedGame);
  };

  const onSelectGame = (index: number) => {
    setSelectedGameId(displayGames[index]?.id ?? null);
    setFocusZone("grid");
    rootRef.current?.focus({ preventScroll: true });
  };

  const playCompletedGame = () => {
    const game = completedGame;
    setCompletedGame(null);
    if (game) void onPlay(game);
  };

  const rootClass = libraryRoomClass(focusZone, showcaseMode, Boolean(selectedGame));
  const pinnedAppIds = useMemo(() => new Set(trackedAppIds), [trackedAppIds]);

  return (
    <section ref={rootRef} className={rootClass} tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={markActivity} aria-label="Biblioteca">
      {selectedGame ? (
        <>
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
            actions={actions}
            focusZone={focusZone}
            actionIndex={actionIndex}
            actionRefs={actionRefs}
            setFocusZone={setFocusZone}
            setActionIndex={setActionIndex}
            onAction={onAction}
          />
          <DownloadCatalogPanel
            games={displayGames}
            downloads={effectiveDownloads}
            accountCount={accountCount}
            selectedIndex={selectedIndex}
            gridRef={gridRef}
            pinnedAppIds={pinnedAppIds}
            onSelect={onSelectGame}
          />
        </>
      ) : <EmptyLibraryContent gridRef={gridRef} loading={loading} />}
      <LibraryHint />
      {completedGame ? (
        <DownloadCompleteDialog
          game={completedGame}
          busy={busy}
          onPlay={playCompletedGame}
          onClose={() => setCompletedGame(null)}
        />
      ) : null}
    </section>
  );
}
