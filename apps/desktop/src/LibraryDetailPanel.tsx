import EditorialGameVideo from "./EditorialGameVideo";
import { selectEditorialVideo } from "./editorialVideos";
import PluginDownloadButton from "./PluginDownloadButton";
import { cacheMediaImage, useMediaPoster } from "./mediaPosterCache";


import {useI18n} from "./i18n";
import CircularScrollbar from "./CircularScrollbar";
import { scheduleSelectedMedia } from "./selectedMediaDelay";
import { useSharedMediaAudio } from "./sharedMediaAudio";
import { cachedLibraryCover } from "./libraryCoverResolver";
import { selectSteamTrailer, steamTrailerSource } from "./steamTrailer";
import { useSteamTrailer } from "./useSteamTrailer";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Gamepad2, Globe, Image as ImageIcon, Loader2, Monitor, Network, Pause, Play, RotateCw, ThumbsDown, ThumbsUp, User, Users, Volume2, VolumeX } from "lucide-react";
import { hasTauriRuntime } from "./native";
import { gameMatchesLibraryFeature, normalizeSearchText, type LibraryFeatureKey } from "./librarySearch";

import {
  afterDetailImage,
  afterDetailVideo,
  createDetailMediaSequence,
  disableDetailVideo,
  normalizeDetailImages,
  removeFailedDetailImage,
  type DetailMediaSequenceState,
} from "./detailMediaSequence";
import { downloadManager } from "./downloadManager";
import { GenericDownloadProgressView } from "./GenericDownloadProgress";
import { steamDownloadMetrics } from "./nativeDownloadMetrics";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { ArtworkState, FocusZone, LibraryAction } from "./LibraryRoomParts";
import type { CatalogGame, GameDetails, SteamMovie } from "./types";
import { useSelectedGameDetails } from "./useSelectedGameDetails";

const SCREENSHOT_HOLD_MS = 8_000;

function firstPresent<T>(...values: Array<T | null | undefined>): T | undefined {
  return values.find((value) => value != null) ?? undefined;
}

function plainText(value?: string | null): string {
  return (value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function selectedMovie(details: GameDetails | null): SteamMovie | undefined {
  const movies = details?.steam?.movies;
  return selectSteamTrailer(movies);
}

function selectedVideo(movie?: SteamMovie): string | undefined {
  return steamTrailerSource(movie);
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
  return normalizeDetailImages(details?.steam?.screenshots?.map((shot) => shot.full ?? shot.thumbnail) ?? []);
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
  // biome-ignore lint/security/noDangerouslySetInnerHtml: content is reduced to an allowlist and safe HTTPS attributes above.
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
    return () => { cancelled = true; image.onload = null; image.src = ""; };
  }, [source]);

  return { layers, activeLayer };
}

interface LegacyMediaProps {
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

export interface FeaturePanelProps extends LegacyMediaProps {
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

function actionClass(action: LibraryAction, selected: boolean): string {
  const kind = action.kind === "play" ? "play" : action.kind === "cancel" ? "cancel" : "download";
  return `glass-action ${kind} ${selected ? "is-selected" : ""}`.trim();
}

function ActionButtons(props: FeaturePanelProps) {
  const { t } = useI18n();
  return <div className="library-room-actions glass-actions-row">
    {props.actions.map((action, index) => action.kind === "download"
      ? <PluginDownloadButton key={props.game.id} game={props.game} disabled={action.disabled} className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)} buttonRef={node => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} />
      : <button type="button" key={action.kind}
        ref={node => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }}
        data-action={action.kind} title={action.reason ?? undefined}
        className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)}
        onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }}
        onClick={() => props.onAction(index)} disabled={action.disabled}>
        <span className="glass-action-icon">{action.icon}</span>
        <span className="glass-action-label">{action.kind === "play" ? t("downloadsPlay") : action.kind === "cancel" ? t("downloadsCancel") : action.label}</span>
      </button>)}
  </div>;
}

function PreferenceButtons(props: Pick<FeaturePanelProps, "game" | "preference" | "onPreference">) {
  return (
    <div className="library-room-preferences">
      <span>¿Te gusta?</span>
      <button type="button" className={props.preference === 1 ? "selected" : ""} onClick={() => props.onPreference(1)} aria-label="Me gusta"><ThumbsUp size={18} /></button>
      <button type="button" className={props.preference === -1 ? "selected negative" : ""} onClick={() => props.onPreference(-1)} aria-label="No me gusta"><ThumbsDown size={18} /></button>
    </div>
  );
}

function LegacyDisplayMedia(props: LegacyMediaProps) {
  const muted = props.videoMuted || props.videoVolume === 0;
  return (
    <>
      <div className="library-room-feature-ambient" aria-hidden="true">
        {props.artwork.layers.map((source, index) => source ? <img key={`ambient-${index}-${source}`} className={index === props.artwork.activeLayer ? "is-active" : ""} src={source} alt="" draggable={false} /> : null)}
      </div>
      <div className="library-room-feature-media">
        {props.artwork.layers.map((source, index) => source ? <img key={`hero-${index}-${source}`} className={`library-room-hero-layer ${index === props.artwork.activeLayer ? "is-active" : ""}`} src={source} alt="" draggable={false} /> : null)}
        {props.videoSrc ? <video key={props.videoSrc} ref={props.videoRef} className={`library-room-video ${props.readyVideoSrc === props.videoSrc ? "is-ready" : ""}`} src={props.videoSrc} poster={props.movie?.thumbnail} autoPlay muted={props.videoMuted} playsInline preload="auto" onLoadedMetadata={(event) => props.onVideoMetadata(event.currentTarget)} onCanPlay={(event) => props.onVideoReady(event.currentTarget)} onEnded={(event) => props.onVideoMetadata(event.currentTarget)} /> : null}
        <div className="library-room-feature-shade" />
        {props.videoSrc ? <div className="library-room-media-controls" onPointerDown={(event) => event.stopPropagation()}><button type="button" onClick={props.onToggleSound} aria-label={muted ? "Activar sonido" : "Silenciar video"}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button><input aria-label="Volumen del video" type="range" min="0" max="1" step="0.02" value={props.videoMuted ? 0 : props.videoVolume} onChange={(event) => props.onVolumeChange(Number(event.currentTarget.value))} /></div> : null}
      </div>
    </>
  );
}

function LegacyDisplayFeature(props: FeaturePanelProps) {
  return (
    <aside className="library-room-feature">
      <LegacyDisplayMedia {...props} />
      <div className="library-room-feature-copy">
        <header className="library-room-overview">
          <h1>{props.game.name}</h1>
          <p className="library-room-lead">{props.summary}</p>
          <ActionButtons {...props} />
          <PreferenceButtons {...props} />
        </header>
      </div>
    </aside>
  );
}

interface MediaController {
  state: DetailMediaSequenceState;
  setState: React.Dispatch<React.SetStateAction<DetailMediaSequenceState>>;
  videoRef: RefObject<HTMLVideoElement>;
  videoSrc?: string;
  fallback?: string;
  artwork: ReturnType<typeof useCrossfadeArtwork>;
  muted: boolean;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
  volume: number;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  paused: boolean;
  setPaused: React.Dispatch<React.SetStateAction<boolean>>;
  readyVideo: boolean;
  setReadyVideo: React.Dispatch<React.SetStateAction<boolean>>;
  reducedMotion: boolean;
}

function useDesktopMedia(game: CatalogGame, details: GameDetails | null): MediaController {
  const reducedMotion = useReducedMotion();
  const [mediaReady, setMediaReady] = useState(false);
  useEffect(() => scheduleSelectedMedia(() => setMediaReady(true)), []);
  const movie = mediaReady ? selectedMovie(details) : undefined;
  const videoSrc = selectedVideo(movie);
  const images = useMemo(() => mediaReady ? screenshotImages(details) : [], [details, mediaReady]);
  const cachedPoster = useMediaPoster(game.app_id);
  const fallback = cachedPoster ?? (mediaReady && details ? fallbackArtwork(game, details) : cachedLibraryCover(game.app_id) ?? game.capsule_image ?? undefined);
  const posterSource = images[0] ?? fallbackArtwork(game, details);
  useEffect(() => mediaReady ? cacheMediaImage(game.app_id, posterSource) : undefined, [game.app_id, posterSource, mediaReady]);
  const { muted, volume, setMuted, setVolume } = useSharedMediaAudio();
  const [paused, setPaused] = useState(reducedMotion);
  const [readyVideo, setReadyVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<DetailMediaSequenceState>(() => createDetailMediaSequence({ videoSrc, images, reducedMotion }));
  useSteamTrailer(videoRef, videoSrc, state.phase === "video" && state.videoAvailable, game.app_id, () => setState((current) => disableDetailVideo(current)));
  const currentImage = state.phase === "image" ? (state.images[state.imageIndex] ?? fallback) : fallback;
  const artwork = useCrossfadeArtwork(currentImage);
  useEffect(() => {
    setReadyVideo(false);
    setPaused(reducedMotion);
    setState(createDetailMediaSequence({ videoSrc, images, reducedMotion }));
  }, [videoSrc, images, reducedMotion]);

  useEffect(() => {
    if (paused || state.phase !== "image" || reducedMotion || state.images.length === 0) return;
    const timer = window.setInterval(() => setState((current) => afterDetailImage(current)), SCREENSHOT_HOLD_MS);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion, state.phase, state.images.length]);

  useEffect(() => {
    if (state.phase !== "image" || state.images.length < 2) return;
    const next = state.images[(state.imageIndex + 1) % state.images.length];
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
    else if (readyVideo) void video.play().catch(() => setPaused(true));
  }, [paused, state.phase, volume, muted, readyVideo]);

  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) video.pause();
      else if (!paused && state.phase === "video") void video.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [paused, state.phase]);

  return { state, setState, videoRef, videoSrc, fallback, artwork, muted, setMuted, volume, setVolume, paused, setPaused, readyVideo, setReadyVideo, reducedMotion };
}

function MediaControls({ model }: { model: MediaController }) {
  const toggle = () => {
    if (model.paused && model.reducedMotion && model.videoSrc) model.setState((current) => ({ ...current, phase: "video", videoAvailable: true }));
    model.setPaused((current) => !current);
  };
  return (
    <div className="library-room-media-controls">
      <button type="button" onClick={toggle} aria-label={model.paused ? "Reanudar medios" : "Pausar medios"}>{model.paused ? <Play size={16} /> : <Pause size={16} />}</button>
      {model.videoSrc ? <><button type="button" onClick={() => model.setMuted((current) => !current)} aria-label={model.muted ? "Activar sonido" : "Silenciar"}>{model.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><input aria-label="Volumen del video" type="range" min="0" max="1" step="0.02" value={model.muted ? 0 : model.volume} onChange={(event) => { const next = Number(event.currentTarget.value); model.setVolume(next); model.setMuted(next <= 0); }} /></> : null}
    </div>
  );
}

function SteamDetailMedia({ game, details }: { game: CatalogGame; details: GameDetails | null }) {
  const model = useDesktopMedia(game, details);
  return (
    <div className="library-detail-media">
      <div className="library-room-feature-ambient" aria-hidden="true">{model.artwork.layers.map((source, index) => source ? <img key={`ambient-${index}-${source}`} className={index === model.artwork.activeLayer ? "is-active" : ""} src={source} alt="" draggable={false} /> : null)}</div>
      <div className="library-room-feature-media">
        {model.artwork.layers.map((source, index) => source ? <img key={`detail-${index}-${source}`} className={`library-room-hero-layer ${index === model.artwork.activeLayer ? "is-active" : ""}`} src={source} alt="" draggable={false} onError={() => model.setState((current) => removeFailedDetailImage(current, source))} /> : null)}
        {model.videoSrc && model.state.phase === "video" && model.state.videoAvailable ? <video key={`${game.id}-${model.videoSrc}`} ref={model.videoRef} className={`library-room-video ${model.readyVideo ? "is-ready" : ""}`} poster={model.fallback} autoPlay={!model.paused} muted={model.muted} playsInline preload="metadata" onCanPlay={() => { model.setReadyVideo(true); if (!model.paused) void model.videoRef.current?.play().catch(() => undefined); }} onEnded={() => model.setState((current) => afterDetailVideo(current))} onError={() => model.setState((current) => disableDetailVideo(current))} /> : null}
        <div className="library-room-feature-shade" />
        {model.videoSrc && (model.paused || model.state.phase !== "video") ? <button type="button" className="ga-media-play" aria-label="Reproducir tráiler" onClick={() => { model.setState(current => ({ ...current, phase: "video", videoAvailable: true })); model.setPaused(false); }}><Play size={48} fill="currentColor" strokeWidth={0} /></button> : null}
        <span className="ga-media-badge">Tráiler y capturas</span>
        <span className="ga-media-caption"><ImageIcon aria-hidden="true" />{model.state.phase === "video" ? "Tráiler del juego" : "Capturas del juego"}</span>
        <MediaControls model={model} />
      </div>
      <div className="ga-media-thumbnails">{model.state.images.slice(0, 4).map((source, index) => <button type="button" key={source} aria-label={`Ver captura ${index + 1}`} aria-pressed={model.state.phase === "image" && model.state.imageIndex === index} onClick={() => { model.setPaused(true); model.setState(current => ({ ...current, phase: "image", imageIndex: index })); }}><img src={source} alt="" /></button>)}</div>
      <div className="ga-media-bottom"><span><ImageIcon aria-hidden="true" />{model.state.images.length} capturas</span><span className="ga-media-pagination" aria-hidden="true">{model.state.images.slice(0, 4).map((source, index) => <i key={source} className={model.state.imageIndex === index ? "is-active" : ""} />)}</span></div>
    </div>
  );
}

function DesktopDetailMedia({ game, details }: { game: CatalogGame; details: GameDetails | null }) {
  const { locale } = useI18n();
  const [shot, setShot] = useState<string | null>(null);
  if (!selectEditorialVideo(game.app_id, locale)) return <SteamDetailMedia game={game} details={details} />;
  const images = screenshotImages(details);
  const english = locale === "en";
  return <div className="library-detail-media">
    {shot ? <img className="ga-editorial-screenshot" src={shot} alt={english ? `Screenshot of ${game.name}` : `Captura de ${game.name}`} /> : <EditorialGameVideo key={game.app_id} appId={game.app_id} />}
    <div className="ga-media-thumbnails">
      <button type="button" aria-pressed={!shot} onClick={() => setShot(null)}>Video</button>
      {images.slice(0, 4).map((source, index) => <button type="button" key={source} aria-label={english ? `View screenshot ${index + 1}` : `Ver captura ${index + 1}`} aria-pressed={shot === source} onClick={() => setShot(source)}><img src={source} alt="" /></button>)}
    </div>
  </div>;
}

function SteamHeaderArtwork({ game, details }: { game: CatalogGame; details: GameDetails | null }) {
  const appId = game.app_id;
  const sources = [...new Set([
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg` : undefined,
    details?.steam?.hero_image,
    game.hero_image,
    details?.steam?.header_image,
    game.header_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` : undefined,
    appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : undefined,
    game.hero_image,
    game.capsule_image,
  ].filter((source): source is string => typeof source === "string" && Boolean(source.trim())).map(source => source.trim()))];
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];

  // Reset failed-source state when fresh metadata or a different game arrives.
  useEffect(() => setSourceIndex(0), [game.id, details?.steam?.hero_image]);
  return <div className="library-detail-header-art" aria-hidden="true">
    {source ? <img src={source} alt="" draggable={false} onError={() => setSourceIndex(index => index + 1)} /> : null}
  </div>;
}

/** Only single-player / multiplayer capabilities belong in the detail view. */
function DetailPlayModes({ game, details }: { game: CatalogGame; details: GameDetails | null }) {
  const categories = details?.steam?.categories ?? game.categories ?? [];
  const normalized = categories.map(normalizeSearchText);
  const evidence = { ...game, categories };
  const has = (key: LibraryFeatureKey, expressions: string[]) => gameMatchesLibraryFeature(evidence, key)
    || normalized.some(value => expressions.some(expression => value.includes(expression)));
  const modes = [
    { key: "single_player", label: "Un jugador", Icon: User, visible: has("single_player", ["un jugador", "single-player", "single player"]) },
    { key: "local_coop", label: "Co-op Local", Icon: Monitor, visible: has("local_coop", ["cooperativo local", "local co-op", "cooperativo de pantalla", "shared/split screen co-op"]) },
    { key: "coop_lan", label: "Co-op LAN", Icon: Network, visible: has("coop_lan", ["lan co-op", "cooperativo lan"]) },
    { key: "online_coop", label: "Co-op Online", Icon: Users, visible: has("online_coop", ["cooperativo en linea", "online co-op"]) },
    { key: "local_multiplayer", label: "Multiplayer Local", Icon: Monitor, visible: has("local_multiplayer", ["jcj de pantalla", "shared/split screen pvp"]) },
    { key: "multiplayer_lan", label: "Multiplayer LAN", Icon: Network, visible: has("multiplayer_lan", ["lan pvp"]) },
    { key: "online_multiplayer", label: "Multiplayer Online", Icon: Users, visible: has("online_multiplayer", []) },
    { key: "mmo", label: "MMO", Icon: Globe, visible: has("mmo", ["multijugador masivo", "mmo", "massively multiplayer"]) },
  ];
  // General Steam flags are useful when the source has no local/online subtype.
  if (!modes.some(mode => mode.key.includes("coop") && mode.visible) && has("coop", ["cooperativo", "co-op"])) modes.push({ key: "coop", label: "Cooperativo", Icon: Users, visible: true });
  if (!modes.some(mode => mode.key.includes("multiplayer") && mode.visible) && has("multiplayer", ["multijugador", "multi-player"])) modes.push({ key: "multiplayer", label: "Multijugador", Icon: Users, visible: true });
  return <div className="ga-detail-modes">{modes.filter(mode => mode.visible).map(({ key, label, Icon }) => <span key={key}><Icon aria-hidden="true" />{label}</span>)}</div>;
}

function platforms(details: GameDetails | null): string {
  const steam = details?.steam;
  if (!steam) return "No informado";
  return [steam.windows ? "Windows" : null, steam.mac ? "macOS" : null, steam.linux ? "Linux" : null].filter(Boolean).join(" · ") || "No informado";
}

function compactValue(values?: string[], limit = 3): string {
  if (!values?.length) return "No informado";
  return values.length > limit ? `${values.slice(0, limit).join(" · ")} · +${values.length - limit}` : values.join(" · ");
}

function useInstallSize(appId: number | null): string {
  const [size, setSize] = useState("No informado");
  useEffect(() => {
    if (!appId) {
      setSize("No informado");
      return;
    }
    let active = true;
    setSize("Consultando…");
    void steamDownloadMetrics(appId).then(metrics => {
      if (!active) return;
      const installedBytes = metrics.installed_size_bytes;
      const estimatedBytes = metrics.estimated_install_size_bytes;
      const bytes = installedBytes ?? estimatedBytes;
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
        setSize("No informado");
        return;
      }
      const amount = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(bytes / 1_000_000_000);
      setSize(`${installedBytes != null ? "" : "≈ "}${amount} GB${installedBytes != null ? "" : " · estimado"}`);
    });
    return () => { active = false; };
  }, [appId]);
  return size;
}

function SteamFacts({ details, game }: { details: GameDetails | null; game: CatalogGame }) {
  const steam = details?.steam;
  game = details ?? game;
  const installSize = useInstallSize(game.app_id);
  const rating = typeof game.steam_review_score === "number"
    ? `${Math.round(game.steam_review_score)}% positivas${game.steam_review_count ? ` · ${new Intl.NumberFormat("es").format(game.steam_review_count)} reseñas` : ""}`
    : "Sin puntuación disponible";
  const recommendations = steam?.recommendation_count ?? game.recommendation_count;
  const facts = [
    ["Tamaño", installSize],
    ["Género", compactValue(steam?.genres)],
    ["Valoración de usuarios", rating],
    ["Recomendaciones Steam", typeof recommendations === "number" ? new Intl.NumberFormat("es").format(recommendations) : "No informado"],
    ["Idiomas", plainText(steam?.supported_languages) || "No informado"],
    ["Desarrollador", compactValue(steam?.developers, 2)],
    ["Editor", compactValue(steam?.publishers, 2)],
    ["Lanzamiento", steam?.release_date || "No informado"],
    ["Plataformas", platforms(details)],
  ];
  return <dl className="library-room-game-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function ActiveDownloadFacts({ download }: { download?: ManagedDownloadStatus }) {
  if (!download || (!downloadManager.isTracked(download) && !download.progress && !download.statusText)) return null;
  return <GenericDownloadProgressView download={download} />;
}

function ExtendedDetails({ details }: { details: GameDetails | null }) {
  const steam = details?.steam;
  const about = steam?.about_the_game || steam?.detailed_description || "";
  const minimum = steam?.minimum_requirements ?? "";
  const recommended = steam?.recommended_requirements ?? "";
  return (
    <div className="library-detail-extended">
      {about ? <section className="library-room-copy-block"><h3>Acerca del juego</h3><SteamRichText html={about} /></section> : null}
      {minimum || recommended ? <section className="library-room-requirements-block">{minimum ? <div><h3>Requisitos mínimos</h3><SteamRichText html={minimum} /></div> : null}{recommended ? <div><h3>Requisitos recomendados</h3><SteamRichText html={recommended} /></div> : null}</section> : null}

    </div>
  );
}

function DesktopFeature(props: FeaturePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const detailState = useSelectedGameDetails({ surface: "desktop", selectedGameId: props.game.id, detailRequestedGameId: props.game.id, tabletDetailsOpen: true, localSteamAppId: props.game.app_id });
  const details = detailState.details;
  const ratingGame = details ?? props.game;
  const description = plainText(details?.steam?.short_description);
  const summary = description || (detailState.loading ? "Cargando descripción de Steam…" : "Descripción no disponible");
  const installSize = useInstallSize(props.game.app_id);
  const steam = details?.steam;
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("surface") === "tablet") {
    return <aside className="library-room-feature"><SteamHeaderArtwork game={props.game} details={details} /><section className="library-detail-essential" aria-label="Resumen esencial del juego"><DesktopDetailMedia game={props.game} details={details} /><section className="library-room-first-row"><header className="library-room-overview"><h1>{props.game.name}</h1><p className="library-room-lead">{summary}</p></header><div className="library-room-control-row"><ActionButtons {...props} /><PreferenceButtons {...props} /></div></section><section className="library-room-second-row"><SteamFacts details={details} game={props.game} /><ActiveDownloadFacts download={props.download} /></section></section><ExtendedDetails details={details} /></aside>;
  }
  return (
    <article className="ga-game-detail">
      <SteamHeaderArtwork game={props.game} details={details} />
      <div className="ga-detail-body">
        <section className="ga-detail-info" aria-label="Información del juego">
          <div className="ga-detail-heading-tools"><p className="ga-detail-eyebrow">{(steam?.genres ?? props.game.genres)?.join(" · ")}</p>{hasTauriRuntime() && props.game.app_id ? <button className="ga-steam-refresh" type="button" title="Actualizar datos de Steam" aria-label="Actualizar datos de Steam" disabled={!details || detailState.refreshingSteam} onClick={() => void detailState.refreshSteam()}><RotateCw size={16} className={detailState.refreshingSteam ? "is-refreshing" : undefined} /></button> : null}</div>
          <h1>{props.game.name}</h1>
          <div className="ga-detail-facts"><span>{steam?.release_date ?? props.game.release_date ?? "Lanzamiento no informado"}</span><span>{installSize}</span><span>{platforms(details)}</span></div>
          <DetailPlayModes game={props.game} details={details} />
          <div className="ga-scroll-frame ga-detail-scroll-frame">
          <div ref={scrollRef} className="ga-detail-scroll">
            <p className="ga-detail-lead">{summary}</p>
            {detailState.loading ? <span role="status">Cargando ficha de Steam…</span> : detailState.error ? <span role="status">Steam no respondió; podés seguir navegando.</span> : null}
            {detailState.refreshingSteam ? <small role="status">Actualizando datos de Steam…</small> : detailState.steamRefreshMessage ? <small role="status">{detailState.steamRefreshMessage}</small> : null}
            <div className="ga-detail-rating"><strong>{ratingGame.steam_review_score != null ? `${Math.round(ratingGame.steam_review_score)}%` : "—"}</strong><span>Valoración de usuarios en Steam<br />{ratingGame.steam_review_count ? `${ratingGame.steam_review_count.toLocaleString("es")} reseñas` : "Sin puntuación disponible"}</span></div>
            <ExtendedDetails details={details} />
            <section className="ga-detail-metadata"><h3>Más información</h3><SteamFacts details={details} game={props.game} />{props.game.tags?.length ? <><h3>Etiquetas</h3><div className="ga-detail-tags">{props.game.tags.map(tag => <span key={tag}>{tag}</span>)}</div></> : null}</section>
            <ActiveDownloadFacts download={props.download} />
          </div>
          <CircularScrollbar targetRef={scrollRef} label="Desplazar información del juego" />
          </div>
          <div className="ga-detail-actions"><ActionButtons {...props} /><button type="button" className="ga-favorite" aria-label="Me gusta" aria-pressed={props.preference === 1} onClick={() => props.onPreference(1)}><ThumbsUp size={22} fill={props.preference === 1 ? "currentColor" : "none"} /></button><button type="button" className="ga-favorite" aria-label="No me gusta" aria-pressed={props.preference === -1} onClick={() => props.onPreference(-1)}><ThumbsDown size={19} /></button></div>
        </section>
        <section className="ga-detail-gallery" aria-label="Videos y capturas"><DesktopDetailMedia game={props.game} details={details} /><p className="ga-gallery-note"><Gamepad2 aria-hidden="true" /><span>Videos y capturas del juego<br />Elegí una captura para explorar la galería.</span></p></section>
      </div>
    </article>
  );
}

function isDisplaySurface(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("surface") === "display";
}

export function FeaturePanel(props: FeaturePanelProps) {
  return isDisplaySurface() ? <LegacyDisplayFeature {...props} /> : <DesktopFeature key={props.game.id} {...props} />;
}
