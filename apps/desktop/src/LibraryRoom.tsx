import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MutableRefObject, ReactNode, RefObject } from "react";
import { Download, Gamepad2, Info, Loader2, Play, Volume2, VolumeX } from "lucide-react";

import { loadDetails } from "./api";
import type { SteamDownloadStatus } from "./native";
import { playUiSound } from "./uiSounds";
import type { CatalogGame, GameDetails, SteamMovie } from "./types";

type DownloadMap = Record<number, SteamDownloadStatus>;
type FocusZone = "grid" | "actions";

type LibraryAction = {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  kind: "play" | "download" | "details";
};

interface LibraryRoomProps {
  games: CatalogGame[];
  downloads: DownloadMap;
  busy: boolean;
  onPlay: (game: CatalogGame) => void | Promise<void>;
  onDownload: (game: CatalogGame) => void | Promise<void>;
  onOpenDetails: (game: CatalogGame) => void;
  loading?: boolean;
}

interface ArtworkState {
  layers: [string | null, string | null];
  activeLayer: number;
}

const ACTIVE_DOWNLOAD_STATES = new Set(["requested", "preparing", "downloading"]);
const ACTION_BACK_KEYS = new Set(["escape", "s", "arrowdown"]);
const ACTION_PREVIOUS_KEYS = new Set(["a", "arrowleft", "w", "arrowup"]);
const ACTION_NEXT_KEYS = new Set(["d", "arrowright"]);

function firstPresent<T>(...values: Array<T | null | undefined>): T | undefined {
  for (const value of values) {
    if (value != null) return value;
  }
  return undefined;
}

function artworkCandidates(game: CatalogGame) {
  const appId = game.app_id;
  const candidates = [
    game.capsule_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg` : null,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg` : null,
    appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg` : null,
    game.header_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` : null,
    appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : null,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}

function SteamCover({ game }: { game: CatalogGame }) {
  const sources = artworkCandidates(game);
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  if (!source) return <span className="library-cover-fallback"><Gamepad2 size={34} /></span>;
  return <img key={source} src={source} alt="" draggable={false} loading="lazy" onError={() => setSourceIndex((current) => current + 1)} />;
}

function isInstalled(status?: SteamDownloadStatus) {
  return status?.state === "installed" || status?.installed === true;
}

function isActiveDownload(status?: SteamDownloadStatus) {
  return Boolean(status && ACTIVE_DOWNLOAD_STATES.has(status.state));
}

function InstallStateBadge({ status, available }: { status?: SteamDownloadStatus; available: boolean }) {
  if (!isInstalled(status) || !available) return null;
  return <span className="library-install-state ready" title="Instalado · listo para jugar"><Play size={12} fill="currentColor" /></span>;
}

function useCrossfadeArtwork(source?: string): ArtworkState {
  const initial: [string | null, string | null] = [source ?? null, null];
  const [layers, setLayers] = useState<[string | null, string | null]>(initial);
  const [activeLayer, setActiveLayer] = useState(0);
  const layersRef = useRef<[string | null, string | null]>(initial);
  const activeRef = useRef(0);

  useEffect(() => {
    if (!source || layersRef.current[activeRef.current] === source) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.src = source;

    const reveal = async () => {
      try {
        await image.decode();
      } catch {
        // onload is enough on engines without decode support.
      }
      if (cancelled || !image.naturalWidth) return;
      const next = activeRef.current === 0 ? 1 : 0;
      const nextLayers: [string | null, string | null] = [...layersRef.current] as [string | null, string | null];
      nextLayers[next] = source;
      layersRef.current = nextLayers;
      setLayers(nextLayers);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (cancelled) return;
        activeRef.current = next;
        setActiveLayer(next);
      }));
    };

    if (image.complete && image.naturalWidth) void reveal();
    else image.onload = () => { void reveal(); };
    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, [source]);

  return { layers, activeLayer };
}

function selectedDownload(appId: number | null | undefined, downloads: DownloadMap) {
  if (!appId) return undefined;
  return downloads[appId];
}

function selectedHero(details: GameDetails | null, game?: CatalogGame) {
  return firstPresent(
    details?.steam?.screenshots?.[0]?.full,
    details?.steam?.background,
    details?.steam?.hero_image,
    game?.hero_image,
    game?.header_image,
    game?.capsule_image,
  );
}

function selectedMovie(details: GameDetails | null): SteamMovie | undefined {
  const movies = details?.steam?.movies;
  if (!movies?.length) return undefined;
  return movies.find((item) => item.highlight) ?? movies[0];
}

function selectedVideo(movie?: SteamMovie) {
  return firstPresent(movie?.mp4, movie?.webm);
}

function selectedSummary(details: GameDetails | null) {
  return firstPresent(
    details?.steam?.short_description,
    "Seleccionado de la biblioteca combinada de tus cuentas Steam.",
  ) ?? "";
}

function libraryRoomClass(focusZone: FocusZone, showcaseMode: boolean, hasSelection: boolean) {
  if (!hasSelection) return "library-room focus-grid is-empty";
  if (showcaseMode) return `library-room focus-${focusZone} is-showcase`;
  return `library-room focus-${focusZone}`;
}

function buildActions(
  game: CatalogGame | undefined,
  installed: boolean,
  activeDownload: boolean,
  busy: boolean,
  progress?: number | null,
): LibraryAction[] {
  if (!game) return [];
  return [
    {
      label: installed ? "Jugar" : "No instalado",
      icon: busy ? <Loader2 className="spin" size={23} /> : <Play size={23} fill="currentColor" />,
      disabled: !installed || busy || game.copies_available <= 0,
      kind: "play",
    },
    {
      label: installed ? "Instalado" : activeDownload ? `${Math.round(progress ?? 0)}%` : "Descargar",
      icon: activeDownload ? <Loader2 className="spin" size={23} /> : <Download size={23} />,
      disabled: !game.app_id || installed || activeDownload,
      kind: "download",
    },
    {
      label: "Ficha completa",
      icon: <Info size={23} />,
      disabled: false,
      kind: "details",
    },
  ];
}

interface ActionKeyContext {
  actionIndex: number;
  actionRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  setActionIndex: (index: number) => void;
  returnToGrid: () => void;
  activateAction: () => void;
}

function focusAction(index: number, context: ActionKeyContext) {
  playUiSound("move");
  context.setActionIndex(index);
  context.actionRefs.current[index]?.focus({ preventScroll: true });
}

function handleActionKey(key: string, context: ActionKeyContext) {
  if (ACTION_BACK_KEYS.has(key)) {
    context.returnToGrid();
    return true;
  }
  if (ACTION_PREVIOUS_KEYS.has(key)) {
    focusAction((context.actionIndex - 1 + 3) % 3, context);
    return true;
  }
  if (ACTION_NEXT_KEYS.has(key)) {
    focusAction((context.actionIndex + 1) % 3, context);
    return true;
  }
  if (key === "enter") {
    context.activateAction();
    return true;
  }
  return false;
}

interface GridKeyContext {
  selectedIndex: number;
  columns: number;
  enterActions: () => void;
  moveGrid: (delta: number) => void;
}

function handleGridKey(key: string, context: GridKeyContext) {
  if (key === "enter") {
    context.enterActions();
    return true;
  }
  if (key === "escape") return true;
  if (ACTION_PREVIOUS_KEYS.has(key)) {
    if (context.selectedIndex % context.columns === 0) context.enterActions();
    else context.moveGrid(-1);
    return true;
  }
  if (ACTION_NEXT_KEYS.has(key)) {
    context.moveGrid(1);
    return true;
  }
  if (key === "w" || key === "arrowup") {
    context.moveGrid(-context.columns);
    return true;
  }
  if (key === "s" || key === "arrowdown") {
    context.moveGrid(context.columns);
    return true;
  }
  return false;
}

function LibraryHint() {
  return (
    <div className="library-room-hint">
      <span>NAVEGAR · WASD / FLECHAS</span>
      <span>ENTRAR / ACTIVAR · ENTER</span>
      <span>VOLVER · ESC</span>
    </div>
  );
}

function EmptyLibraryContent({ gridRef, loading }: { gridRef: RefObject<HTMLDivElement | null>; loading: boolean }) {
  return (
    <>
      <aside className="library-room-feature">
        <div className="library-room-feature-shade" />
        <div className="library-room-feature-copy">
          <span className="eyebrow">TU BIBLIOTECA</span>
          <h1>{loading ? "Preparando tu biblioteca…" : "Tu biblioteca está vacía"}</h1>
          <p>{loading ? "GameAccess está cargando las cuentas y juegos recordados en Steam." : "No encontramos juegos todavía. Podés seguir usando GameAccess; cuando aparezcan juegos en tus cuentas Steam, se mostrarán acá."}</p>
          {loading ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando biblioteca…</span> : null}
        </div>
      </aside>
      <section className="library-room-catalog">
        <header className="library-room-heading"><small>0 juegos · WASD / FLECHAS</small></header>
        <div ref={gridRef} className="library-room-grid library-room-empty-grid">
          <div className="library-room-empty-state">
            <Gamepad2 size={42} />
            <strong>{loading ? "Buscando juegos…" : "No hay juegos para mostrar"}</strong>
            <span>{loading ? "La interfaz ya está lista; sólo estamos esperando los datos." : "Este es un estado válido y no bloquea GameAccess."}</span>
          </div>
        </div>
      </section>
    </>
  );
}

interface MediaPanelProps {
  artwork: ArtworkState;
  movie?: SteamMovie;
  videoSrc?: string;
  readyVideoSrc: string | null;
  videoMuted: boolean;
  videoVolume: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideoMetadata: (video: HTMLVideoElement) => void;
  onVideoReady: (video: HTMLVideoElement) => void;
  onToggleSound: () => void;
  onVolumeChange: (value: number) => void;
}

function MediaPanel(props: MediaPanelProps) {
  return (
    <>
      <div className="library-room-feature-ambient" aria-hidden="true">
        {props.artwork.layers.map((source, index) => source ? <img key={`ambient-${index}-${source}`} className={index === props.artwork.activeLayer ? "is-active" : ""} src={source} alt="" draggable={false} /> : null)}
      </div>
      <div className="library-room-feature-media">
        {props.artwork.layers.map((source, index) => source ? <img key={`hero-${index}-${source}`} className={`library-room-hero-layer ${index === props.artwork.activeLayer ? "is-active" : ""}`} src={source} alt="" draggable={false} /> : null)}
        {props.videoSrc ? (
          <video
            key={props.videoSrc}
            ref={props.videoRef}
            className={`library-room-video ${props.readyVideoSrc === props.videoSrc ? "is-ready" : ""}`}
            src={props.videoSrc}
            poster={props.movie?.thumbnail}
            autoPlay
            muted={props.videoMuted}
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => props.onVideoMetadata(event.currentTarget)}
            onCanPlay={(event) => props.onVideoReady(event.currentTarget)}
            onEnded={(event) => props.onVideoMetadata(event.currentTarget)}
          />
        ) : null}
        <div className="library-room-feature-shade" />
        {props.videoSrc ? <MediaControls {...props} /> : null}
      </div>
    </>
  );
}

function MediaControls(props: MediaPanelProps) {
  const muted = props.videoMuted || props.videoVolume === 0;
  return (
    <div className="library-room-media-controls" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="library-room-volume-toggle"
        onClick={props.onToggleSound}
        aria-label={muted ? "Activar sonido" : "Silenciar video"}
        title={muted ? "Activar sonido" : "Silenciar"}
      >
        {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </button>
      <input
        aria-label="Volumen del video"
        type="range"
        min="0"
        max="1"
        step="0.02"
        value={props.videoMuted ? 0 : props.videoVolume}
        onChange={(event) => props.onVolumeChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

interface FeaturePanelProps extends MediaPanelProps {
  game: CatalogGame;
  showcaseMode: boolean;
  summary: string;
  loadingDetails: boolean;
  actions: LibraryAction[];
  focusZone: FocusZone;
  actionIndex: number;
  actionRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  setFocusZone: (zone: FocusZone) => void;
  setActionIndex: (index: number) => void;
  onAction: (index: number) => void;
}

function FeaturePanel(props: FeaturePanelProps) {
  return (
    <aside className="library-room-feature">
      <MediaPanel {...props} />
      <div className="library-room-feature-copy">
        <span className="eyebrow">{props.showcaseMode ? "MODO VITRINA" : "TU BIBLIOTECA"}</span>
        <h1>{props.game.name}</h1>
        <p>{props.summary}</p>
        {props.loadingDetails ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando medios de Steam…</span> : null}
        <div className="library-room-actions">
          {props.actions.map((action, index) => (
            <button
              type="button"
              key={action.label}
              ref={(node) => { props.actionRefs.current[index] = node; }}
              data-action={action.kind}
              className={`library-room-action ${props.focusZone === "actions" && props.actionIndex === index ? "is-selected" : ""}`}
              onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }}
              onClick={() => props.onAction(index)}
              disabled={action.disabled}
            >
              {action.icon}<strong>{action.label}</strong>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

interface CatalogPanelProps {
  games: CatalogGame[];
  downloads: DownloadMap;
  accountCount: number;
  selectedIndex: number;
  gridRef: RefObject<HTMLDivElement | null>;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

function CatalogPanel(props: CatalogPanelProps) {
  const accountLabel = props.accountCount === 1 ? "cuenta" : "cuentas";
  const accounts = props.accountCount ? ` · ${props.accountCount} ${accountLabel}` : "";
  return (
    <section className="library-room-catalog">
      <header className="library-room-heading"><small>{props.games.length} juegos{accounts} · WASD / FLECHAS</small></header>
      <div ref={props.gridRef} className="library-room-grid">
        {props.games.map((game, index) => (
          <button
            type="button"
            key={game.id}
            className={`library-room-card ${index === props.selectedIndex ? "is-selected" : ""}`}
            onMouseEnter={() => props.onHover(index)}
            onClick={() => props.onSelect(index)}
            aria-current={index === props.selectedIndex ? "true" : undefined}
            aria-label={`${index === props.selectedIndex ? "Seleccionado: " : "Seleccionar "}${game.name}`}
            tabIndex={-1}
          >
            <span className="library-room-card-art">
              <SteamCover game={game} />
              <InstallStateBadge status={game.app_id ? props.downloads[game.app_id] : undefined} available={game.copies_available > 0} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function LibraryRoom({ games, downloads, busy, onPlay, onDownload, onOpenDetails, loading = false }: LibraryRoomProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
  const idleTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const showcaseEnteredRef = useRef(false);

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
    const key = event.key.toLowerCase();
    const handled = focusZone === "actions"
      ? handleActionKey(key, { actionIndex, actionRefs, setActionIndex, returnToGrid, activateAction })
      : handleGridKey(key, { selectedIndex, columns, enterActions, moveGrid });
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

  const onHoverGame = (index: number) => {
    markActivity();
    if (index !== selectedIndex) playUiSound("move");
    setSelectedIndex(index);
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
            onHover={onHoverGame}
            onSelect={onSelectGame}
          />
        </>
      ) : <EmptyLibraryContent gridRef={gridRef} loading={loading} />}
      <LibraryHint />
    </section>
  );
}
