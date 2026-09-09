import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Download, Gamepad2, Loader2, Play, XCircle } from "lucide-react";

import { isTrackedDownload } from "./downloadManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
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
  return status?.state === "installed" || status?.state === "prepared" || status?.installed === true;
}

export function isActiveDownload(status?: ManagedDownloadStatus) {
  return isTrackedDownload(status);
}

function InstallStateBadge({ status }: { game: CatalogGame; status?: ManagedDownloadStatus }) {
  if (!isInstalled(status)) return null;
  return <span className="library-install-state ready" title="Listo para presionar Jugar"><Play size={12} fill="currentColor" /></span>;
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

export function selectedPortraitHero(game?: CatalogGame) {
  const appId = game?.app_id;
  return firstPresent(
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg` : undefined,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg` : undefined,
    game?.capsule_image,
    game?.hero_image,
    game?.header_image,
  );
}

export function selectedWideArtworkSlides(details: GameDetails | null, game?: CatalogGame) {
  const appId = game?.app_id;
  const screenshots = details?.steam?.screenshots?.flatMap((shot) => shot.full || shot.thumbnail ? [shot.full ?? shot.thumbnail ?? ""] : []) ?? [];
  const candidates = [
    details?.steam?.hero_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg` : undefined,
    details?.steam?.background,
    game?.hero_image,
    game?.header_image,
    ...screenshots,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
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
    return [{
      label: "Jugar",
      icon: busy ? <Loader2 className="spin" size={23} /> : <Play size={23} fill="currentColor" />,
      disabled: busy,
      reason: busy ? "GameAccess está preparando otra sesión." : null,
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

export { FeaturePanel } from "./LibraryDetailPanel";

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
              <InstallStateBadge game={game} status={game.app_id ? props.downloads[game.app_id] : undefined} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
