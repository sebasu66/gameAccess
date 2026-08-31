import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { loadDetails } from "./api";
import {
  buildActions,
  CatalogPanel,
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

export default function LibraryRoom({ games, downloads, busy, onPlay, onDownload, onOpenDetails, loading = false }: LibraryRoomProps) {
  const rootRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const showcaseEnteredRef = useRef(false);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focusZone, setFocusZone] = useState<FocusZone>("grid");
  const [actionIndex, setActionIndex] = useState(0);
  const [columns, setColumns] = useState(4);
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showcaseMode, setShowcaseMode] = useState(false);
  const [readyVideoSrc, setReadyVideoSrc] = useState<string | null>(null);
  const [videoMuted, setVideoMuted] = useState(true);
  const [videoVolume, setVideoVolume] = useState(0.68);

  const selectedGame = firstPresent(games[selectedIndex], games[0]);
  const selectedGameId = selectedGame?.id;
  const selectedAppId = selectedGame?.app_id;
  const accountCount = useMemo(() => new Set(games.flatMap((game) => game.local_account_labels ?? [])).size, [games]);
  const download = selectedDownload(selectedAppId, downloads);
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
    setSelectedIndex((current) => Math.min(current, Math.max(0, games.length - 1)));
  }, [games.length]);

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
    if (games.length < 2 || showcaseEnteredRef.current) return;
    showcaseEnteredRef.current = true;
    setSelectedIndex((current) => {
      let next = Math.floor(Math.random() * games.length);
      if (next === current) next = (next + 1) % games.length;
      return next;
    });
  }, [showcaseMode, games.length]);

  useEffect(() => {
    if (!showcaseMode || games.length < 2 || selectedGameId == null) return;
    const holdMs = videoSrc ? 110_000 : 90_000;
    const timer = window.setTimeout(() => {
      setSelectedIndex((current) => {
        let next = Math.floor(Math.random() * games.length);
        if (next === current) next = (next + 1) % games.length;
        return next;
      });
    }, holdMs);
    return () => window.clearTimeout(timer);
  }, [showcaseMode, games.length, selectedGameId, videoSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = videoVolume;
    video.muted = videoMuted;
  }, [videoVolume, videoMuted]);

  useEffect(() => {
    if (!games.length) return;
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
  }, [games.length]);

  useEffect(() => {
    if (selectedGameId == null) return;
    let cancelled = false;
    setDetails(null);
    setLoadingDetails(true);
    loadDetails(selectedGameId)
      .then((value) => { if (!cancelled) setDetails(value); })
      .catch(() => { if (!cancelled) setDetails(null); })
      .finally(() => { if (!cancelled) setLoadingDetails(false); });
    return () => { cancelled = true; };
  }, [selectedGameId]);

  useEffect(() => {
    if (selectedGameId == null) return;
    if (installed) setActionIndex(0);
    else if (selectedAppId) setActionIndex(1);
    else setActionIndex(2);
  }, [selectedGameId, selectedAppId, installed]);

  const moveGrid = (delta: number) => {
    setSelectedIndex((current) => {
      const next = Math.max(0, Math.min(games.length - 1, current + delta));
      if (next !== current) playUiSound("move");
      return next;
    });
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
    setSelectedIndex(index);
    setFocusZone("grid");
    rootRef.current?.focus({ preventScroll: true });
  };

  const rootClass = libraryRoomClass(focusZone, showcaseMode, Boolean(selectedGame));

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
          <CatalogPanel
            games={games}
            downloads={downloads}
            accountCount={accountCount}
            selectedIndex={selectedIndex}
            gridRef={gridRef}
            onSelect={onSelectGame}
          />
        </>
      ) : <EmptyLibraryContent gridRef={gridRef} loading={loading} />}
      <LibraryHint />
    </section>
  );
}
