import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Loader2, Pause, Play, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react";

import {
  afterDetailImage,
  afterDetailVideo,
  createDetailMediaSequence,
  disableDetailVideo,
  normalizeDetailImages,
  removeFailedDetailImage,
  type DetailMediaSequenceState,
} from "./detailMediaSequence";
import { downloadProgress, formatDownloadBytes, formatDownloadEta, formatDownloadSpeed, isTrackedDownload } from "./downloadManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { FocusZone, LibraryAction } from "./LibraryRoomParts";
import type { CatalogGame, GameDetails, SteamMovie } from "./types";

const SCREENSHOT_HOLD_MS = 8_000;

function firstPresent<T>(...values: Array<T | null | undefined>): T | undefined {
  return values.find((value) => value != null) ?? undefined;
}

function selectedMovie(details: GameDetails | null): SteamMovie | undefined {
  const movies = details?.steam?.movies;
  if (!movies?.length) return undefined;
  return movies.find((item) => item.highlight) ?? movies[0];
}

function selectedVideo(movie?: SteamMovie): string | undefined {
  return firstPresent(movie?.mp4, movie?.webm);
}

function fallbackArtwork(game: CatalogGame, details: GameDetails | null): string | undefined {
  const appId = game.app_id;
  return firstPresent(
    details?.steam?.hero_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg` : undefined,
    details?.steam?.background,
    game.hero_image,
    game.header_image,
    game.capsule_image,
  );
}

function screenshotImages(details: GameDetails | null): string[] {
  return normalizeDetailImages(
    details?.steam?.screenshots?.map((shot) => shot.full ?? shot.thumbnail) ?? [],
  );
}

function plainText(value?: string | null): string {
  return (value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeSteamRichHtml(value?: string | null): string {
  if (!value) return "";
  if (typeof DOMParser === "undefined") return plainText(value);
  const document = new DOMParser().parseFromString(value, "text/html");
  const allowed = new Set(["P", "DIV", "BR", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "H1", "H2", "H3", "H4", "A", "IMG"]);
  for (const node of Array.from(document.body.querySelectorAll("*"))) {
    if (!allowed.has(node.tagName)) {
      const parent = node.parentNode;
      if (!parent) continue;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      continue;
    }
    const href = node.tagName === "A" ? node.getAttribute("href") : null;
    const src = node.tagName === "IMG" ? node.getAttribute("src") : null;
    const alt = node.tagName === "IMG" ? node.getAttribute("alt") : null;
    for (const attribute of Array.from(node.attributes)) node.removeAttribute(attribute.name);
    if (href?.startsWith("https://")) {
      node.setAttribute("href", href);
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noreferrer");
    }
    if (src?.startsWith("https://")) {
      node.setAttribute("src", src);
      node.setAttribute("loading", "lazy");
      if (alt) node.setAttribute("alt", alt);
    }
  }
  return document.body.innerHTML;
}

function SteamRichText({ html }: { html: string }) {
  return <div className="steam-rich-text" dangerouslySetInnerHTML={{ __html: sanitizeSteamRichHtml(html) }} />;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return reduced;
}

function useCrossfadeArtwork(source?: string) {
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
      try { await image.decode(); } catch { /* onload fallback */ }
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

interface DetailMediaProps {
  game: CatalogGame;
  details: GameDetails | null;
  displaySurface: boolean;
}

function DetailMedia({ game, details, displaySurface }: DetailMediaProps) {
  const reducedMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const movie = selectedMovie(details);
  const videoSrc = selectedVideo(movie);
  const images = useMemo(() => screenshotImages(details), [details]);
  const fallback = fallbackArtwork(game, details);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.68);
  const [paused, setPaused] = useState(reducedMotion && !displaySurface);
  const [readyVideo, setReadyVideo] = useState(false);
  const [state, setState] = useState<DetailMediaSequenceState>(() => createDetailMediaSequence({ videoSrc, images, reducedMotion: reducedMotion && !displaySurface }));

  useEffect(() => {
    setReadyVideo(false);
    setPaused(reducedMotion && !displaySurface);
    setState(createDetailMediaSequence({ videoSrc, images, reducedMotion: reducedMotion && !displaySurface }));
  }, [game.id, videoSrc, images.join("|"), reducedMotion, displaySurface]);

  const currentImage = state.phase === "image" ? (state.images[state.imageIndex] ?? fallback) : fallback;
  const artwork = useCrossfadeArtwork(currentImage);

  useEffect(() => {
    if (paused || state.phase !== "image" || reducedMotion || state.images.length === 0) return;
    const timer = window.setTimeout(() => setState((current) => afterDetailImage(current)), SCREENSHOT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [paused, reducedMotion, state.phase, state.imageIndex, state.images.length]);

  useEffect(() => {
    if (state.phase !== "image" || state.images.length < 2) return;
    const nextIndex = (state.imageIndex + 1) % state.images.length;
    const next = state.images[nextIndex];
    if (!next) return;
    const image = new Image();
    image.decoding = "async";
    image.src = next;
  }, [state.phase, state.imageIndex, state.images]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    if (paused || state.phase !== "video") video.pause();
    else void video.play().catch(() => setState((current) => disableDetailVideo(current)));
  }, [paused, state.phase, volume, muted]);

  useEffect(() => {
    const handleVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) video.pause();
      else if (!paused && state.phase === "video") void video.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [paused, state.phase]);

  const togglePlayback = () => {
    if (paused && reducedMotion && videoSrc) setState((current) => ({ ...current, phase: "video", videoAvailable: true }));
    setPaused((current) => !current);
  };

  return (
    <div className="library-detail-media" aria-hidden="true">
      <div className="library-room-feature-ambient">
        {artwork.layers.map((source, index) => source ? <img key={`ambient-${index}-${source}`} className={index === artwork.activeLayer ? "is-active" : ""} src={source} alt="" draggable={false} /> : null)}
      </div>
      <div className="library-room-feature-media">
        {artwork.layers.map((source, index) => source ? (
          <img
            key={`detail-${index}-${source}`}
            className={`library-room-hero-layer ${index === artwork.activeLayer ? "is-active" : ""}`}
            src={source}
            alt=""
            draggable={false}
            onError={() => setState((current) => removeFailedDetailImage(current, source))}
          />
        ) : null)}
        {videoSrc && state.phase === "video" && state.videoAvailable ? (
          <video
            key={`${game.id}-${videoSrc}`}
            ref={videoRef}
            className={`library-room-video ${readyVideo ? "is-ready" : ""}`}
            src={videoSrc}
            poster={fallback}
            autoPlay={!paused}
            muted={muted}
            playsInline
            preload="metadata"
            onCanPlay={() => { setReadyVideo(true); if (!paused) void videoRef.current?.play().catch(() => undefined); }}
            onEnded={() => setState((current) => afterDetailVideo(current))}
            onError={() => setState((current) => disableDetailVideo(current))}
          />
        ) : null}
        <div className="library-room-feature-shade" />
        <div className="library-room-media-controls" aria-hidden="false">
          <button type="button" onClick={togglePlayback} aria-label={paused ? "Reanudar medios" : "Pausar medios"} title={paused ? "Reanudar" : "Pausar"}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          {videoSrc ? (
            <>
              <button type="button" onClick={() => setMuted((current) => !current)} aria-label={muted ? "Activar sonido" : "Silenciar"} title={muted ? "Activar sonido" : "Silenciar"}>
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input aria-label="Volumen del video" type="range" min="0" max="1" step="0.02" value={muted ? 0 : volume} onChange={(event) => { const next = Number(event.currentTarget.value); setVolume(next); setMuted(next <= 0); }} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface FeaturePanelProps {
  game: CatalogGame;
  showcaseMode: boolean;
  loadingDetails: boolean;
  detailsError?: string | null;
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
  displaySurface?: boolean;
}

function platforms(details: GameDetails | null): string {
  const steam = details?.steam;
  if (!steam) return "No informado";
  const values = [steam.windows ? "Windows" : null, steam.mac ? "macOS" : null, steam.linux ? "Linux" : null].filter(Boolean);
  return values.length ? values.join(" · ") : "No informado";
}

function compactValue(values?: string[], limit = 3): string {
  if (!values?.length) return "No informado";
  return values.length > limit ? `${values.slice(0, limit).join(" · ")} · +${values.length - limit}` : values.join(" · ");
}

function ActiveDownloadFacts({ download }: { download?: ManagedDownloadStatus }) {
  if (!isTrackedDownload(download)) return null;
  const rows = [
    download?.bytes_total != null ? ["Tamaño", formatDownloadBytes(download.bytes_total)] : null,
    download?.bytes_downloaded != null ? ["Descargado", formatDownloadBytes(download.bytes_downloaded)] : null,
    download?.speed_bps != null ? ["Velocidad", formatDownloadSpeed(download.speed_bps)] : null,
    download?.eta_seconds != null ? ["Tiempo restante", formatDownloadEta(download.eta_seconds)] : null,
  ].filter((row): row is string[] => Boolean(row));
  const progress = downloadProgress(download);
  if (!rows.length && !Number.isFinite(progress)) return null;
  return (
    <div className="library-room-active-download" aria-label="Descarga activa">
      {rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      {Number.isFinite(progress) ? <div className="library-room-progress-inline"><span style={{ width: `${progress}%` }} /><strong>{Math.round(progress)}%</strong></div> : null}
    </div>
  );
}

export function FeaturePanel(props: FeaturePanelProps) {
  const steam = props.details?.steam;
  const description = plainText(steam?.short_description);
  const summary = description || (props.loadingDetails ? "Cargando descripción de Steam…" : "Descripción no disponible");
  const about = steam?.about_the_game ?? "";
  const minimum = steam?.minimum_requirements ?? "";
  const recommended = steam?.recommended_requirements ?? "";

  return (
    <aside className="library-room-feature">
      <section className="library-detail-essential" aria-label="Resumen esencial del juego">
        <DetailMedia game={props.game} details={props.details} displaySurface={Boolean(props.displaySurface)} />
        <div className="library-detail-essential-overlay" />
        <section className="library-room-first-row" aria-label="First row">
          <header className="library-room-overview">
            <h1>{props.game.name}</h1>
            <p className="library-room-lead">{summary}</p>
            {props.loadingDetails ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando ficha de Steam…</span> : null}
            {!props.loadingDetails && props.detailsError ? <span className="library-room-loading">Steam no respondió; podés seguir navegando.</span> : null}
          </header>
          <div className="library-room-control-row">
            <div className="library-room-actions glass-actions-row">
              {props.actions.map((action, index) => (
                <button type="button" key={`${action.kind}-${action.label}`} ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} data-action={action.kind} title={action.reason ?? undefined} className={`glass-action ${action.kind === "play" ? "play" : action.kind === "cancel" ? "cancel" : "download"} ${props.focusZone === "actions" && props.actionIndex === index ? "is-selected" : ""}`} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} onClick={() => props.onAction(index)} disabled={action.disabled}>
                  <span className="glass-action-icon">{action.icon}</span><span className="glass-action-label">{action.label}</span>
                </button>
              ))}
            </div>
            <div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>
              <button type="button" className={props.preference === 1 ? "selected" : ""} onClick={() => props.onPreference(1)} aria-label="Me gusta"><ThumbsUp size={16} /></button>
              <button type="button" className={props.preference === -1 ? "selected negative" : ""} onClick={() => props.onPreference(-1)} aria-label="No me gusta"><ThumbsDown size={16} /></button>
            </div>
          </div>
        </section>

        <section className="library-room-second-row" aria-label="Second row">
          <dl className="library-room-game-facts">
            <div><dt>Géneros</dt><dd>{compactValue(steam?.genres)}</dd></div>
            <div><dt>Funciones Steam</dt><dd>{compactValue(steam?.categories, 4)}</dd></div>
            <div><dt>Desarrollador</dt><dd>{compactValue(steam?.developers, 2)}</dd></div>
            <div><dt>Publisher</dt><dd>{compactValue(steam?.publishers, 2)}</dd></div>
            <div><dt>Lanzamiento</dt><dd>{steam?.release_date || "No informado"}</dd></div>
            <div><dt>Plataformas</dt><dd>{platforms(props.details)}</dd></div>
          </dl>
          {props.game.copies_total > 0 ? <div className="library-room-availability-fact"><span>GameAccess</span><strong>{props.game.copies_available} / {props.game.copies_total} copias disponibles</strong></div> : null}
          <ActiveDownloadFacts download={props.download} />
        </section>
      </section>

      <div className="library-detail-extended" tabIndex={0} aria-label="Detalles extendidos del juego">
        {about ? <section className="library-room-copy-block library-room-third-row" aria-label="Third row"><h3>Acerca del juego</h3><SteamRichText html={about} /></section> : null}
        {steam?.categories?.length ? <section className="library-room-copy-block"><h3>Funciones y categorías de Steam</h3><p>{steam.categories.join(" · ")}</p></section> : null}
        {minimum || recommended ? (
          <section className="library-room-requirements-block">
            {minimum ? <div><h3>Requisitos mínimos</h3><SteamRichText html={minimum} /></div> : null}
            {recommended ? <div><h3>Requisitos recomendados</h3><SteamRichText html={recommended} /></div> : null}
          </section>
        ) : null}
        {steam?.screenshots?.length ? (
          <section className="library-room-gallery-block">
            <h3>Capturas</h3>
            <div className="library-room-screenshots">{steam.screenshots.slice(0, 8).map((shot, index) => shot.full || shot.thumbnail ? <img key={shot.id ?? index} src={shot.full ?? shot.thumbnail} alt="" loading="lazy" /> : null)}</div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
