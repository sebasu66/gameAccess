import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Download, Gamepad2, Loader2, Play, ThumbsDown, ThumbsUp, Volume2, VolumeX, XCircle } from "lucide-react";

import { downloadProgress, formatDownloadBytes, formatDownloadEta, formatDownloadSpeed, isTrackedDownload } from "./downloadManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { playAvailability } from "./gameAvailability";
import { playUiSound } from "./uiSounds";
import type { CatalogGame, GameDetails, SteamMovie } from "./types";

export type DownloadMap = Record<number, ManagedDownloadStatus>;
export type FocusZone = "grid" | "actions";

export type LibraryAction = {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  kind: "play" | "download" | "cancel" | "verify";
  reason?: string | null;
};

export interface ArtworkState {
  layers: [string | null, string | null];
  activeLayer: number;
}

const ACTION_PREVIOUS_KEYS = new Set(["a", "arrowleft", "w", "arrowup"]);
const ACTION_NEXT_KEYS = new Set(["d", "arrowright", "s", "arrowdown"]);

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

export function isInstalled(status?: ManagedDownloadStatus) {
  return status?.state === "installed" || status?.installed === true;
}

export function isActiveDownload(status?: ManagedDownloadStatus) {
  return isTrackedDownload(status);
}

function InstallStateBadge({ status }: { status?: ManagedDownloadStatus }) {
  if (!isInstalled(status)) return null;
  return <span className="library-install-state ready" title="Instalado"><Play size={12} fill="currentColor" /></span>;
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
      try { await image.decode(); } catch { /* onload is enough when decode is unavailable */ }
      if (cancelled || !image.naturalWidth) return;
      const next = activeRef.current === 0 ? 1 : 0;
      const nextLayers: [string | null, string | null] = [...layersRef.current] as [string | null, string | null];
      nextLayers[next] = source;
      layersRef.current = nextLayers;
      activeRef.current = next;
      setLayers(nextLayers);
      setActiveLayer(next);
    };

    if (image.complete && image.naturalWidth) void reveal();
    else image.onload = () => { void reveal(); };
    return () => { cancelled = true; image.onload = null; };
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
    game?.header_image,
    game?.hero_image,
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
  return firstPresent(details?.steam?.short_description, "Seleccionado de la biblioteca combinada de tus cuentas Steam.") ?? "";
}

export function libraryRoomClass(focusZone: FocusZone, showcaseMode: boolean, hasSelection: boolean) {
  if (!hasSelection) return "library-room focus-grid is-empty";
  if (showcaseMode) return `library-room focus-${focusZone} is-showcase`;
  return `library-room focus-${focusZone}`;
}

export function buildActions(game: CatalogGame | undefined, status: ManagedDownloadStatus | undefined, busy: boolean): LibraryAction[] {
  if (!game) return [];
  if (isInstalled(status)) {
    const availability = playAvailability(game, busy);
    return [{
      label: "Jugar",
      icon: busy ? <Loader2 className="spin" size={23} /> : <Play size={23} fill="currentColor" />,
      disabled: !availability.allowed,
      reason: availability.reason,
      kind: "play",
    }];
  }
  if (status?.state === "cancelling") {
    return [{ label: "Cancelando…", icon: <Loader2 className="spin" size={23} />, disabled: true, kind: "cancel" }];
  }
  if (isTrackedDownload(status)) {
    return [{ label: "Cancelar descarga", icon: <XCircle size={23} />, disabled: false, kind: "cancel" }];
  }
  if (status?.state === "unknown") {
    return [{ label: "Verificando…", icon: <Loader2 className="spin" size={23} />, disabled: true, kind: "verify" }];
  }
  return [{
    label: "Descargar",
    icon: <Download size={23} />,
    disabled: !game.app_id,
    kind: "download",
  }];
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
  context.actionRefs.current?.[index]?.focus({ preventScroll: true });
}

function actionCount(context: ActionKeyContext) {
  return Math.max(1, context.actionRefs.current?.filter(Boolean).length ?? 0);
}

export function handleActionKey(key: string, context: ActionKeyContext) {
  if (key === "escape") {
    context.returnToGrid();
    return true;
  }
  if (ACTION_PREVIOUS_KEYS.has(key)) {
    focusAction((context.actionIndex - 1 + actionCount(context)) % actionCount(context), context);
    return true;
  }
  if (ACTION_NEXT_KEYS.has(key)) {
    focusAction((context.actionIndex + 1) % actionCount(context), context);
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
  if (key === "a" || key === "arrowleft") {
    if (context.selectedIndex % context.columns !== 0) context.moveGrid(-1);
    return true;
  }
  if (key === "d" || key === "arrowright") {
    if (context.selectedIndex % context.columns !== context.columns - 1) context.moveGrid(1);
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
  details: GameDetails | null;
  download?: ManagedDownloadStatus;
  preference?: 1 | -1;
  onPreference: (value: 1 | -1) => void;
  actions: LibraryAction[];
  focusZone: FocusZone;
  actionIndex: number;
  actionRefs: RefObject<Array<HTMLButtonElement | null>>;
  setFocusZone: (zone: FocusZone) => void;
  setActionIndex: (index: number) => void;
  onAction: (index: number) => void;
}

function plainText(value?: string | null) { return (value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function multiplayerModes(details: GameDetails | null): string[] {
  const categories = details?.steam?.categories ?? [];
  const signals = [["Multi-player","Multijugador"],["Online PvP","PvP online"],["Online Co-op","Co-op online"],["Shared/Split Screen PvP","PvP local / pantalla dividida"],["Shared/Split Screen Co-op","Co-op local / pantalla dividida"],["LAN PvP","PvP LAN"],["LAN Co-op","Co-op LAN"],["Cross-Platform Multiplayer","Cross-platform"],["Remote Play Together","Remote Play Together"]] as const;
  return signals.filter(([needle]) => categories.some((value) => value.toLowerCase().includes(needle.toLowerCase()))).map(([,label]) => label);
}
export function FeaturePanel(props: FeaturePanelProps) {
  const progress = downloadProgress(props.download);
  const activeDownload = isActiveDownload(props.download);
  const modes = multiplayerModes(props.details);
  const steam = props.details?.steam;
  const about = plainText(steam?.about_the_game);
  const minimum = plainText(steam?.minimum_requirements);
  const recommended = plainText(steam?.recommended_requirements);

  return (
    <aside className="library-room-feature">
      <MediaPanel {...props} />
      <div className="library-room-feature-copy">
        <header className="library-room-overview">
          <span className="eyebrow">{props.showcaseMode ? "MODO VITRINA" : "TU BIBLIOTECA"}</span>
          <h1>{props.game.name}</h1>
          <p className="library-room-lead">{props.summary}</p>
          {props.loadingDetails ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando ficha de Steam…</span> : null}
          <div className="library-room-actions glass-actions-row">
            {props.actions.map((action, index) => (
              <button type="button" key={`${action.kind}-${action.label}`} ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} data-action={action.kind} title={action.reason ?? undefined} className={`glass-action ${action.kind === "play" ? "play" : action.kind === "cancel" ? "cancel" : "download"} ${props.focusZone === "actions" && props.actionIndex === index ? "is-selected" : ""}`} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} onClick={() => props.onAction(index)} disabled={action.disabled}>
                <span className="glass-action-icon">{action.icon}</span><span className="glass-action-label">{action.label}</span>
              </button>
            ))}
          </div>
          <div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>
            <span>¿Te gusta?</span>
            <button type="button" className={props.preference === 1 ? "selected" : ""} onClick={() => props.onPreference(1)} aria-label="Me gusta"><ThumbsUp size={18} /></button>
            <button type="button" className={props.preference === -1 ? "selected negative" : ""} onClick={() => props.onPreference(-1)} aria-label="No me gusta"><ThumbsDown size={18} /></button>
          </div>
        </header>

        <div className="library-room-unified-facts">
          <dl className="library-room-game-facts">
            <div><dt>Género</dt><dd>{steam?.genres?.length ? steam.genres.join(" · ") : "—"}</dd></div>
            <div><dt>Multijugador</dt><dd>{modes.length ? modes.join(" · ") : "Un jugador / no informado"}</dd></div>
            <div><dt>Desarrollador</dt><dd>{steam?.developers?.join(", ") || "—"}</dd></div>
            <div><dt>Publisher</dt><dd>{steam?.publishers?.join(", ") || "—"}</dd></div>
            <div><dt>Lanzamiento</dt><dd>{steam?.release_date || "—"}</dd></div>
            <div><dt>Copias</dt><dd>{props.game.copies_available} / {props.game.copies_total} disponibles</dd></div>
          </dl>
          <div className="library-room-download-summary" aria-label="Descarga">
            <div><span>Tamaño</span><strong>{formatDownloadBytes(props.download?.bytes_total)}</strong></div>
            <div><span>Descargado</span><strong>{formatDownloadBytes(props.download?.bytes_downloaded)}</strong></div>
            <div><span>Velocidad</span><strong>{formatDownloadSpeed(props.download?.speed_bps)}</strong></div>
            <div><span>Tiempo restante</span><strong>{activeDownload ? formatDownloadEta(props.download?.eta_seconds) : "—"}</strong></div>
            {activeDownload ? <div className="library-room-progress-inline"><span style={{ width: `${progress}%` }} /><strong>{Math.round(progress)}%</strong></div> : null}
          </div>
        </div>

        {about ? <section className="library-room-copy-block"><h3>Acerca del juego</h3><p>{about}</p></section> : null}
        {minimum || recommended ? (
          <section className="library-room-requirements-block">
            {minimum ? <div><h3>Requisitos mínimos</h3><p>{minimum}</p></div> : null}
            {recommended ? <div><h3>Requisitos recomendados</h3><p>{recommended}</p></div> : null}
          </section>
        ) : null}
        {steam?.screenshots?.length ? (
          <section className="library-room-gallery-block">
            <h3>Capturas</h3>
            <div className="library-room-screenshots">{steam.screenshots.slice(0, 8).map((shot, index) => shot.thumbnail || shot.full ? <img key={shot.id ?? index} src={shot.thumbnail ?? shot.full} alt="" loading="lazy" /> : null)}</div>
          </section>
        ) : null}
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
            data-library-game-id={game.id}
            onClick={() => props.onSelect(index)}
            aria-current={index === props.selectedIndex ? "true" : undefined}
            aria-label={`${index === props.selectedIndex ? "Seleccionado: " : "Seleccionar "}${game.name}`}
            tabIndex={-1}
          >
            <span className="library-room-card-art">
              <SteamCover game={game} />
              <InstallStateBadge status={game.app_id ? props.downloads[game.app_id] : undefined} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
