import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Download, Gamepad2, Info, Loader2, Play, Volume2, VolumeX } from "lucide-react";

import type { SteamDownloadStatus } from "./native";
import { playUiSound } from "./uiSounds";
import type { CatalogGame, GameDetails, SteamMovie } from "./types";

export type DownloadMap = Record<number, SteamDownloadStatus>;
export type FocusZone = "grid" | "actions";

export type LibraryAction = {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  kind: "play" | "download" | "details";
};

export interface ArtworkState {
  layers: [string | null, string | null];
  activeLayer: number;
}

const ACTIVE_DOWNLOAD_STATES = new Set(["requested", "preparing", "downloading"]);
const ACTION_BACK_KEYS = new Set(["escape", "s", "arrowdown"]);
const ACTION_PREVIOUS_KEYS = new Set(["a", "arrowleft", "w", "arrowup"]);
const ACTION_NEXT_KEYS = new Set(["d", "arrowright"]);

export function firstPresent<T>(...values: Array<T | null | undefined>): T | undefined {
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

export function isInstalled(status?: SteamDownloadStatus) {
  return status?.state === "installed" || status?.installed === true;
}

export function isActiveDownload(status?: SteamDownloadStatus) {
  return Boolean(status && ACTIVE_DOWNLOAD_STATES.has(status.state));
}

function InstallStateBadge({ status, available }: { status?: SteamDownloadStatus; available: boolean }) {
  if (!isInstalled(status) || !available) return null;
  return <span className="library-install-state ready" title="Instalado · listo para jugar"><Play size={12} fill="currentColor" /></span>;
}

export function useCrossfadeArtwork(source?: string): ArtworkState {
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

export function selectedDownload(appId: number | null | undefined, downloads: DownloadMap) {
  if (!appId) return undefined;
  return downloads[appId];
}

export function selectedHero(details: GameDetails | null, game?: CatalogGame) {
  return firstPresent(
    details?.steam?.screenshots?.[0]?.full,
    details?.steam?.background,
    details?.steam?.hero_image,
    game?.hero_image,
    game?.header_image,
    game?.capsule_image,
  );
}

export function selectedMovie(details: GameDetails | null): SteamMovie | undefined {
  const movies = details?.steam?.movies;
  if (!movies?.length) return undefined;
  return movies.find((item) => item.highlight) ?? movies[0];
}

export function selectedVideo(movie?: SteamMovie) {
  return firstPresent(movie?.mp4, movie?.webm);
}

export function selectedSummary(details: GameDetails | null) {
  return firstPresent(
    details?.steam?.short_description,
    "Seleccionado de la biblioteca combinada de tus cuentas Steam.",
  ) ?? "";
}

export function libraryRoomClass(focusZone: FocusZone, showcaseMode: boolean, hasSelection: boolean) {
  if (!hasSelection) return "library-room focus-grid is-empty";
  if (showcaseMode) return `library-room focus-${focusZone} is-showcase`;
  return `library-room focus-${focusZone}`;
}

export function buildActions(
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

export interface ActionKeyContext {
  actionIndex: number;
  actionRefs: RefObject<Array<HTMLButtonElement | null>>;
  setActionIndex: (index: number) => void;
  returnToGrid: () => void;
  activateAction: () => void;
}

function focusAction(index: number, context: ActionKeyContext) {
  playUiSound("move");
  context.setActionIndex(index);
  context.actionRefs.current[index]?.focus({ preventScroll: true });
}

export function handleActionKey(key: string, context: ActionKeyContext) {
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

export interface GridKeyContext {
  selectedIndex: number;
  columns: number;
  enterActions: () => void;
  moveGrid: (delta: number) => void;
}

export function handleGridKey(key: string, context: GridKeyContext) {
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

export function LibraryHint() {
  return (
    <div className="library-room-hint">
      <span>NAVEGAR · WASD / FLECHAS</span>
      <span>ENTRAR / ACTIVAR · ENTER</span>
      <span>VOLVER · ESC</span>
    </div>
  );
}

export function EmptyLibraryContent({ gridRef, loading }: { gridRef: RefObject<HTMLDivElement>; loading: boolean }) {
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
  videoRef: RefObject<HTMLVideoElement>;
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
      <button type="button" className="library-room-volume-toggle" onClick={props.onToggleSound} aria-label={muted ? "Activar sonido" : "Silenciar video"} title={muted ? "Activar sonido" : "Silenciar"}>
        {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </button>
      <input aria-label="Volumen del video" type="range" min="0" max="1" step="0.02" value={props.videoMuted ? 0 : props.videoVolume} onChange={(event) => props.onVolumeChange(Number(event.currentTarget.value))} />
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
  actionRefs: RefObject<Array<HTMLButtonElement | null>>;
  setFocusZone: (zone: FocusZone) => void;
  setActionIndex: (index: number) => void;
  onAction: (index: number) => void;
}

export function FeaturePanel(props: FeaturePanelProps) {
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
  gridRef: RefObject<HTMLDivElement>;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

export function CatalogPanel(props: CatalogPanelProps) {
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
