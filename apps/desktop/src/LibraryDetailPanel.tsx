import { genreLabels } from "./libraryGenres";
import {Download, Store} from "lucide-react";
import { isSteamOwned } from "./steamLibrary";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { useLibraryEntry } from "./libraryScan";
import { notify } from "./toasts";
import { openSteamStore } from "./native";
import { usePluginReady } from "./usePluginReady";
import CooptimusDetails, { CoopFacts, loadCooptimusDetails, type CoopDetails } from "./CooptimusDetails";
import { AiReasonPanel } from "./AiPicks";
import PluginDownloadButton from "./PluginDownloadButton";
import { getPluginSources, type PluginSource } from "./catalog/PluginSources";
import { cacheMediaImage, useMediaPoster } from "./mediaPosterCache";


import {translate, useI18n} from "./i18n";
import CircularScrollbar from "./CircularScrollbar";
import { useMagneticButtons } from "./motion/magnetic";
import { Flip, gsap, motionOk } from "./motion/gsap";
import { scheduleSelectedMedia } from "./selectedMediaDelay";
import { useSharedMediaAudio } from "./sharedMediaAudio";
import { cachedLibraryCover } from "./libraryCoverResolver";
import { selectSteamTrailer, steamTrailerSource } from "./steamTrailer";
import { useSteamTrailer } from "./useSteamTrailer";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Globe, Image as ImageIcon, Loader2, Maximize2, Minimize2, Monitor, Network, Pause, Play, RotateCw, ThumbsDown, ThumbsUp, User, Users, Volume2, VolumeX } from "lucide-react";
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
import type { FocusZone, LibraryAction } from "./LibraryRoomParts";
import type { CatalogGame, GameDetails, SteamMovie } from "./types";
import { useSelectedGameDetails } from "./useSelectedGameDetails";
import { navigationShellEnabled } from "./navigation/navigationSelection";
import "./game-detail-wide.css";

const SCREENSHOT_HOLD_MS = 8_000;

/** Steam approval as a bar that fills on mount and whenever the value changes. */
function RatingBar({ score, count }: { score?: number | null; count?: number | null }) {
  const { t, localeTag } = useI18n();
  const target = typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (target === null) return;
    const frame = requestAnimationFrame(() => setShown(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);
  const tone = target === null ? "none" : target >= 80 ? "great" : target >= 60 ? "mixed" : "bad";
  return <div className="ga-detail-rating">
    <strong>{target === null ? "—" : `${Math.round(target)}%`}</strong>
    <div className="ga-rating-main">
      <div className={`ga-rating-bar is-${tone}`} role="progressbar" aria-label={t("uiValoracionDeUsuariosEn")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={target === null ? undefined : Math.round(target)}><i style={{ width: `${shown}%` }} /></div>
      <span>{t("steamReviewsLabel", { value: count ? t("steamReviewsCount", { count: count.toLocaleString(localeTag) }) : t("noScore") })}</span>
    </div>
  </div>;
}

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

export interface FeaturePanelProps {
  game: CatalogGame;
  showcaseMode: boolean;
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
  const kind = action.kind === "play" ? "play" : action.kind === "manage" ? "manage" : "download";
  return `glass-action ${kind} ${selected ? "is-selected" : ""}`.trim();
}

function SteamStoreButton({ game, primary, className, buttonRef, onFocus }: { game: CatalogGame; primary?: boolean; className?: string; buttonRef?: (node: HTMLButtonElement | null) => void; onFocus?: () => void }) {
  const { t } = useI18n();
  const appId = game.app_id ?? 0;
  if (!appId) return null;
  return <button type="button" ref={buttonRef} onFocus={onFocus} data-action="steam" title={t("detailViewOnSteam")} aria-label={t("detailViewOnSteam")}
    className={primary ? className : "source-options-toggle steam-store-small"} onClick={() => void openSteamStore(appId)}>
    {primary ? <><span className="glass-action-icon"><Store size={23} /></span><span className="glass-action-label">{t("detailViewOnSteam")}</span></> : <Store size={20} />}
  </button>;
}

/** A Steam game one of the player's accounts owns is installed by Steam, not by a download source. */
function SteamInstallButton({ game, className, buttonRef, onFocus }: { game: CatalogGame; className: string; buttonRef: (node: HTMLButtonElement | null) => void; onFocus: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const install = async () => {
    setBusy(true);
    // The download queue hands it to Steam's own install window and follows it (DigitalCatalog.download).
    try { await digitalCatalogService.download(game); notify(t("steamInstallHandedOff", { name: game.name }), { tone: "success" }); }
    catch (error) { notify(t("steamInstallError", { error: error instanceof Error ? error.message : String(error) }), { tone: "error" }); }
    finally { setBusy(false); }
  };
  return <button type="button" ref={buttonRef} onFocus={onFocus} data-action="steam-install" className={className} disabled={busy} onClick={() => void install()}>
    <span className="glass-action-icon">{busy ? <Loader2 className="spin" size={23} /> : <Download size={23} />}</span>
    <span className="glass-action-label">{t("steamInstallMenu")}</span>
  </button>;
}

function ActionButtons(props: FeaturePanelProps) {
  const { t } = useI18n();
  const steamOwned = isSteamOwned(useLibraryEntry(props.game.app_id ?? undefined));
  // The download plugin is optional and installed by hand: until it is installed and synced the detail never
  // says "no download sources"; it offers Play (installed games) or the Steam store page.
  const pluginReady = usePluginReady() === true;
  return <div className="library-room-actions glass-actions-row">
    {props.actions.map((action, index) => action.kind === "download" && steamOwned
      ? <SteamInstallButton key="steam-install" game={props.game} className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)} buttonRef={node => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} />
      : action.kind === "download" && !pluginReady
      ? <SteamStoreButton key="steam" game={props.game} primary className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)} buttonRef={node => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} />
      : action.kind === "download"
      ? <PluginDownloadButton key={props.game.id} game={props.game} disabled={action.disabled} className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)} buttonRef={node => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} />
      : <button type="button" key={action.kind}
        ref={node => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }}
        data-action={action.kind} title={action.reason ?? undefined}
        className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)}
        onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }}
        onClick={() => props.onAction(index)} disabled={action.disabled}>
        <span className="glass-action-icon">{action.icon}</span>
        <span className="glass-action-label">{action.kind === "play" ? t("downloadsPlay") : action.label}</span>
      </button>)}
  {(pluginReady || props.actions.some(action => action.kind === "play")) && <SteamStoreButton game={props.game} />}
  </div>;
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

function MediaControls({ model, expanded, onExpand }: { model: MediaController; expanded?: boolean; onExpand?: () => void }) {
  const { t } = useI18n();
  const toggle = () => {
    if (model.paused && model.reducedMotion && model.videoSrc) model.setState((current) => ({ ...current, phase: "video", videoAvailable: true }));
    model.setPaused((current) => !current);
  };
  return (
    <div className="library-room-media-controls">
      <button type="button" onClick={toggle} aria-label={model.paused ? "Reanudar medios" : "Pausar medios"}>{model.paused ? <Play size={16} /> : <Pause size={16} />}</button>
      {model.videoSrc ? <><button type="button" onClick={() => model.setMuted((current) => !current)} aria-label={model.muted ? "Activar sonido" : "Silenciar"}>{model.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><input aria-label={t("uiVolumenDelVideo")} type="range" min="0" max="1" step="0.02" value={model.muted ? 0 : model.volume} onChange={(event) => { const next = Number(event.currentTarget.value); model.setVolume(next); model.setMuted(next <= 0); }} /></> : null}
      {onExpand ? <button type="button" className="ga-media-expand" onClick={onExpand} aria-pressed={expanded} aria-label={expanded ? t("mediaRestore") : t("mediaMaximize")} title={expanded ? t("mediaRestore") : t("mediaMaximize")}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button> : null}
    </div>
  );
}

/**
 * The trailer and screenshots can fill the whole detail window: the media box grows from its place to the window's
 * size (Flip) and back. Escape, the same button or a double click returns it; Escape then does not close the detail.
 */
function useExpandedMedia() {
  const [expanded, setExpanded] = useState(false);
  const flipState = useRef<Flip.FlipState | null>(null);
  const toggle = () => {
    const media = document.querySelector<HTMLElement>(".ga-detail-gallery .library-room-feature-media, .ga-wide-media .library-room-feature-media");
    flipState.current = media && motionOk() ? Flip.getState(media) : null;
    setExpanded(current => !current);
  };
  useEffect(() => {
    const state = flipState.current;
    flipState.current = null;
    if (state) Flip.from(state, { duration: .5, ease: "expo.inOut", absolute: false, zIndex: 40 });
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded]);
  return { expanded, toggle };
}

function DesktopDetailMedia({ game, details }: { game: CatalogGame; details: GameDetails | null }) {
  const { t } = useI18n();
  const model = useDesktopMedia(game, details);
  const { expanded, toggle } = useExpandedMedia();
  return (
    <div className={`library-detail-media${expanded ? " is-expanded" : ""}`}>
      <div className="library-room-feature-ambient" aria-hidden="true">{model.artwork.layers.map((source, index) => source ? <img key={`ambient-${index}-${source}`} className={index === model.artwork.activeLayer ? "is-active" : ""} src={source} alt="" draggable={false} /> : null)}</div>
      <div className="library-room-feature-media" onDoubleClick={toggle}>
        {model.artwork.layers.map((source, index) => source ? <img key={`detail-${index}-${source}`} className={`library-room-hero-layer ${index === model.artwork.activeLayer ? "is-active" : ""}`} src={source} alt="" draggable={false} onError={() => model.setState((current) => removeFailedDetailImage(current, source))} /> : null)}
        {model.videoSrc && model.state.phase === "video" && model.state.videoAvailable ? <video key={`${game.id}-${model.videoSrc}`} ref={model.videoRef} className={`library-room-video ${model.readyVideo ? "is-ready" : ""}`} poster={model.fallback} autoPlay={!model.paused} muted={model.muted} playsInline preload="metadata" onCanPlay={() => { model.setReadyVideo(true); if (!model.paused) void model.videoRef.current?.play().catch(() => undefined); }} onEnded={() => model.setState((current) => afterDetailVideo(current))} onError={() => model.setState((current) => disableDetailVideo(current))} /> : null}
        <div className="library-room-feature-shade" />
        {model.videoSrc && (model.paused || model.state.phase !== "video") ? <button type="button" className="ga-media-play" aria-label={t("uiReproducirTrailer")} onClick={() => { model.setState(current => ({ ...current, phase: "video", videoAvailable: true })); model.setPaused(false); }}><Play size={48} fill="currentColor" strokeWidth={0} /></button> : null}
        <span className="ga-media-badge">{t("uiTrailerYCapturas")}</span>
        <span className="ga-media-caption"><ImageIcon aria-hidden="true" />{model.state.phase === "video" ? "Tráiler del juego" : "Capturas del juego"}</span>
        <MediaControls model={model} expanded={expanded} onExpand={toggle} />
      </div>
      <div className="ga-media-thumbnails">{model.state.images.slice(0, 4).map((source, index) => <button type="button" key={source} aria-label={`Ver captura ${index + 1}`} aria-pressed={model.state.phase === "image" && model.state.imageIndex === index} onClick={() => { model.setPaused(true); model.setState(current => ({ ...current, phase: "image", imageIndex: index })); }}><img src={source} alt="" /></button>)}</div>
      <div className="ga-media-bottom"><span><ImageIcon aria-hidden="true" />{model.state.images.length} capturas</span><span className="ga-media-pagination" aria-hidden="true">{model.state.images.slice(0, 4).map((source, index) => <i key={source} className={model.state.imageIndex === index ? "is-active" : ""} />)}</span></div>
    </div>
  );
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
  const { t } = useI18n();
  const categories = details?.steam?.categories ?? game.categories ?? [];
  const normalized = categories.map(normalizeSearchText);
  const evidence = { ...game, categories };
  const has = (key: LibraryFeatureKey, expressions: string[]) => gameMatchesLibraryFeature(evidence, key)
    || normalized.some(value => expressions.some(expression => value.includes(expression)));
  const modes = [
    { key: "single_player", label: t("modeSingle"), Icon: User, visible: has("single_player", ["un jugador", "single-player", "single player"]) },
    { key: "local_coop", label: t("modeCoopLocal"), Icon: Monitor, visible: has("local_coop", ["cooperativo local", "local co-op", "cooperativo de pantalla", "shared/split screen co-op"]) },
    { key: "coop_lan", label: t("modeCoopLan"), Icon: Network, visible: has("coop_lan", ["lan co-op", "cooperativo lan"]) },
    { key: "online_coop", label: t("modeCoopOnline"), Icon: Users, visible: has("online_coop", ["cooperativo en linea", "online co-op"]) },
    { key: "local_multiplayer", label: t("modeMultiLocal"), Icon: Monitor, visible: has("local_multiplayer", ["jcj de pantalla", "shared/split screen pvp"]) },
    { key: "multiplayer_lan", label: t("modeMultiLan"), Icon: Network, visible: has("multiplayer_lan", ["lan pvp"]) },
    { key: "online_multiplayer", label: t("modeMultiOnline"), Icon: Users, visible: has("online_multiplayer", []) },
    { key: "mmo", label: "MMO", Icon: Globe, visible: has("mmo", ["multijugador masivo", "mmo", "massively multiplayer"]) },
  ];
  // General Steam flags are useful when the source has no local/online subtype.
  if (!modes.some(mode => mode.key.includes("coop") && mode.visible) && has("coop", ["cooperativo", "co-op"])) modes.push({ key: "coop", label: t("modeCoop"), Icon: Users, visible: true });
  if (!modes.some(mode => mode.key.includes("multiplayer") && mode.visible) && has("multiplayer", ["multijugador", "multi-player"])) modes.push({ key: "multiplayer", label: t("modeMulti"), Icon: Users, visible: true });
  return <div className="ga-detail-modes">{modes.filter(mode => mode.visible).map(({ key, label, Icon }) => <span key={key}><Icon aria-hidden="true" />{label}</span>)}</div>;
}

function platforms(details: GameDetails | null): string {
  const steam = details?.steam;
  if (!steam) return translate("notReported");
  return [steam.windows ? "Windows" : null, steam.mac ? "macOS" : null, steam.linux ? "Linux" : null].filter(Boolean).join(" · ") || translate("notReported");
}

function compactValue(values?: string[], limit = 3): string {
  if (!values?.length) return translate("notReported");
  return values.length > limit ? values.join(" · ") : values.join(" · ");
}

function useInstallSize(appId: number | null): string {
  const { t, localeTag } = useI18n();
  const [size, setSize] = useState(t("notReported"));
  useEffect(() => {
    if (!appId) {
      setSize(t("notReported"));
      return;
    }
    let active = true;
    setSize(t("sizeChecking"));
    void steamDownloadMetrics(appId).then(metrics => {
      if (!active) return;
      const installedBytes = metrics.installed_size_bytes;
      const estimatedBytes = metrics.estimated_install_size_bytes;
      const bytes = installedBytes ?? estimatedBytes;
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
        setSize(t("notReported"));
        return;
      }
      const amount = new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }).format(bytes / 1_000_000_000);
      setSize(`${installedBytes != null ? "" : "≈ "}${amount} GB${installedBytes != null ? "" : t("sizeEstimated")}`);
    });
    return () => { active = false; };
  }, [appId, t, localeTag]);
  return size;
}

function SteamFacts({ details, game }: { details: GameDetails | null; game: CatalogGame }) {
  const { t, localeTag } = useI18n();
  const steam = details?.steam;
  game = details ?? game;
  const installSize = useInstallSize(game.app_id);
  const rating = typeof game.steam_review_score === "number"
    ? t("scoreWithReviews", { score: Math.round(game.steam_review_score), count: game.steam_review_count ? new Intl.NumberFormat(localeTag).format(game.steam_review_count) : "0" })
    : t("noScore");
  const recommendations = steam?.recommendation_count ?? game.recommendation_count;
  const facts = [
    [t("factSize"), installSize],
    [t("factGenre"), compactValue(steam?.genres && genreLabels(steam.genres))],
    [t("factUserRating"), rating],
    [t("factRecommendations"), typeof recommendations === "number" ? new Intl.NumberFormat(localeTag).format(recommendations) : t("notReported")],
    [t("factLanguages"), plainText(steam?.supported_languages) || t("notReported")],
    [t("factDeveloper"), compactValue(steam?.developers, 2)],
    [t("factPublisher"), compactValue(steam?.publishers, 2)],
    [t("factRelease"), steam?.release_date || t("notReported")],
    [t("factPlatforms"), platforms(details)],
    [t("factSteamCategories"), compactValue(steam?.categories ?? game.categories)],
    [t("factAchievements"), steam?.achievement_count != null ? String(steam.achievement_count) : t("notReported")],
    ["Metacritic", steam?.metacritic?.score != null ? String(steam.metacritic.score) + "/100" : t("notReported")],
    [t("factSteamPrice"), steam?.is_free ? t("factFree") : steam?.price?.final_formatted ?? t("notReported")],
  ];
  return <dl className="library-room-game-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function ActiveDownloadFacts({ download }: { download?: ManagedDownloadStatus }) {
  if (!download || (!downloadManager.isTracked(download) && !download.progress && !download.statusText)) return null;
  return <GenericDownloadProgressView download={download} />;
}

function ExtendedDetails({ details }: { details: GameDetails | null }) {
  const { t } = useI18n();
  const steam = details?.steam;
  const about = steam?.about_the_game || steam?.detailed_description || "";
  const minimum = steam?.minimum_requirements ?? "";
  const recommended = steam?.recommended_requirements ?? "";
  return (
    <div className="library-detail-extended">
      {about ? <section className="library-room-copy-block"><h3>{t("uiAcercaDelJuego")}</h3><SteamRichText html={about} /></section> : null}
      {minimum || recommended ? <section className="library-room-requirements-block">{minimum ? <div><h3>{t("uiRequisitosMinimos")}</h3><SteamRichText html={minimum} /></div> : null}{recommended ? <div><h3>{t("uiRequisitosRecomendados")}</h3><SteamRichText html={recommended} /></div> : null}</section> : null}

    </div>
  );
}

function DesktopFeature(props: FeaturePanelProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useMagneticButtons(actionsRef);
  const detailState = useSelectedGameDetails({ selectedGameId: props.game.id, localSteamAppId: props.game.app_id, knownGame: props.game });
  const details = detailState.details;
  const ratingGame = details ?? props.game;
  const description = plainText(details?.steam?.short_description);
  const summary = description || (detailState.loading ? t("descriptionLoading") : t("descriptionUnavailable"));
  const installSize = useInstallSize(props.game.app_id);
  const steam = details?.steam;
  return (
    <article className="ga-game-detail">
      <SteamHeaderArtwork game={props.game} details={details} />
      <div className="ga-detail-body">
        <section className="ga-detail-info" aria-label={t("uiInformacionDelJuego")}>
          <div className="ga-detail-heading-tools"><p className="ga-detail-eyebrow">{genreLabels(steam?.genres ?? props.game.genres).join(" · ")}</p>{hasTauriRuntime() && props.game.app_id ? <button className="ga-steam-refresh" type="button" title={t("uiActualizarDatosDeSteam")} aria-label={t("uiActualizarDatosDeSteam")} disabled={!details || detailState.refreshingSteam} onClick={() => void detailState.refreshSteam()}><RotateCw size={16} className={detailState.refreshingSteam ? "is-refreshing" : undefined} /></button> : null}</div>
          <h1>{props.game.name}</h1>
          <div className="ga-detail-facts"><span>{steam?.release_date ?? props.game.release_date ?? "Lanzamiento no informado"}</span><span>{installSize}</span><span>{platforms(details)}</span></div>
          <DetailPlayModes game={props.game} details={details} />
          <div className="ga-scroll-frame ga-detail-scroll-frame">
          <div ref={scrollRef} className="ga-detail-scroll">
            <p className="ga-detail-lead">{summary}</p>
            {detailState.loading ? <span role="status">{t("uiCargandoFichaDeSteam")}</span> : detailState.error ? <span role="status">Steam no respondió; podés seguir navegando.</span> : null}
            <RatingBar score={ratingGame.steam_review_score} count={ratingGame.steam_review_count} />
            <ExtendedDetails details={details} />
            <section className="ga-detail-metadata"><h3>{t("uiMasInformacion")}</h3><SteamFacts details={details} game={props.game} />{props.game.tags?.length ? <><h3>{t("uiEtiquetas")}</h3><div className="ga-detail-tags">{props.game.tags.map(tag => <span key={tag}>{tag}</span>)}</div></> : null}</section>
            <ActiveDownloadFacts download={props.download} />
          </div>
          <CircularScrollbar targetRef={scrollRef} label={t("uiDesplazarInformacionDelJuego")} />
          </div>
          <div ref={actionsRef} className="ga-detail-actions"><ActionButtons {...props} /><button type="button" className="ga-favorite" aria-label={t("uiMeGusta")} aria-pressed={props.preference === 1} onClick={() => props.onPreference(1)}><ThumbsUp size={22} fill={props.preference === 1 ? "currentColor" : "none"} /></button><button type="button" className="ga-favorite" aria-label={t("uiNoMeGusta")} aria-pressed={props.preference === -1} onClick={() => props.onPreference(-1)}><ThumbsDown size={19} /></button></div>
        </section>
        <section className="ga-detail-gallery" aria-label={t("uiVideosYCapturas")}><DesktopDetailMedia game={props.game} details={details} />{props.showcaseMode ? null : <AiReasonPanel game={props.game} />}<CooptimusDetails appId={props.game.app_id} name={props.game.name} enabled={!props.showcaseMode} /></section>
      </div>
    </article>
  );
}

export function FeaturePanel(props: FeaturePanelProps) {
  return navigationShellEnabled() ? <WideDetail key={props.game.id} {...props} /> : <DesktopFeature key={props.game.id} {...props} />;
}

type DetailSection = "summary" | "description" | "more" | "requirements" | "sources" | "coop";

/** RN7: the current game data in the wide smoke layout; no example metadata from the design prototype. */
function WideDetail(props: FeaturePanelProps) {
  const { t, localeTag } = useI18n();
  const detailState = useSelectedGameDetails({ selectedGameId: props.game.id, localSteamAppId: props.game.app_id, knownGame: props.game });
  const details = detailState.details;
  const steam = details?.steam;
  const about = steam?.about_the_game || steam?.detailed_description || "";
  const requirements = Boolean(steam?.minimum_requirements || steam?.recommended_requirements);
  const description = plainText(steam?.short_description) || plainText(props.game.short_description);
  const installSize = useInstallSize(props.game.app_id);
  const [section, setSection] = useState<DetailSection>("summary");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const pluginReady = usePluginReady() === true;
  const [sources, setSources] = useState<PluginSource[] | null>(null);
  const [coop, setCoop] = useState<CoopDetails | null>(null);
  const [coopLoading, setCoopLoading] = useState(false);
  const [shownPercent, setShownPercent] = useState(0);
  useMagneticButtons(actionsRef);

  useEffect(() => {
    if (!pluginReady || props.actions.some(action => action.kind === "play")) { setSources(null); return; }
    let active = true;
    setSources(null);
    void getPluginSources(props.game).then(value => { if (active) setSources(value); }).catch(() => { if (active) setSources([]); });
    return () => { active = false; };
  }, [pluginReady, props.game]);

  useEffect(() => {
    if (props.showcaseMode || !props.game.app_id) { setCoop(null); setCoopLoading(false); return; }
    let active = true;
    setCoop(null); setCoopLoading(true);
    void loadCooptimusDetails(props.game.app_id, props.game.name).then(value => {
      if (active) { setCoop(value?.state === "ready" ? value : null); setCoopLoading(false); }
    }).catch(() => { if (active) setCoopLoading(false); });
    return () => { active = false; };
  }, [props.game.app_id, props.game.name, props.showcaseMode]);

  const moveParallax = (event: React.PointerEvent<HTMLElement>) => {
    if (!motionOk() || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    stageRef.current?.style.setProperty("--ga-detail-pointer-x", String(x));
    stageRef.current?.style.setProperty("--ga-detail-pointer-y", String(y));
  };
  const resetParallax = () => {
    stageRef.current?.style.setProperty("--ga-detail-pointer-x", "0");
    stageRef.current?.style.setProperty("--ga-detail-pointer-y", "0");
  };

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const fit = () => {
      title.style.fontSize = "";
      let size = parseFloat(getComputedStyle(title).fontSize);
      const minimum = parseFloat(getComputedStyle(title).getPropertyValue("--ga-detail-title-min"));
      while (title.scrollWidth > title.clientWidth + 1 && size > minimum) {
        size -= 1;
        title.style.fontSize = `${size}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(title);
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [props.game.name]);

  useEffect(() => {
    if (section === "description" && !about || section === "requirements" && !requirements || section === "sources" && sources !== null && !sources.length || section === "coop" && !coopLoading && !coop) setSection("summary");
  }, [section, about, requirements, sources, coop, coopLoading]);

  const tabs = [
    { id: "summary" as const, label: t("uiResumenEsencialDelJuego") },
    ...(about ? [{ id: "description" as const, label: t("uiAcercaDelJuego") }] : []),
    { id: "more" as const, label: t("uiMasInformacion") },
    ...(requirements ? [{ id: "requirements" as const, label: t("uiRequisitosDelJuego") }] : []),
    ...(pluginReady && !props.actions.some(action => action.kind === "play") && (sources === null || sources.length) ? [{ id: "sources" as const, label: t("uiFuentesDeDescarga") }] : []),
    ...(coopLoading || coop ? [{ id: "coop" as const, label: t("modeCoop") }] : []),
  ];
  const score = typeof (details ?? props.game).steam_review_score === "number" ? (details ?? props.game).steam_review_score : null;
  const count = (details ?? props.game).steam_review_count;
  const circumference = 2 * Math.PI * 42;
  const percent = score == null ? 0 : Math.max(0, Math.min(100, score));
  useEffect(() => {
    const counter = { value: 0 };
    const tween = gsap.to(counter, { value: percent, duration: motionOk() ? .9 : 0, ease: "power2.out", onUpdate: () => setShownPercent(counter.value) });
    return () => { tween.kill(); };
  }, [percent]);
  const tone = score == null ? "unknown" : percent >= 80 ? "great" : percent >= 60 ? "mixed" : "bad";
  const recommendations = steam?.recommendation_count ?? props.game.recommendation_count;
  const metacritic = steam?.metacritic?.score ?? props.game.metacritic_score;

  return <article ref={stageRef} className="ga-game-detail ga-game-detail-wide" data-rating-tone={tone} onPointerMove={moveParallax} onPointerLeave={resetParallax}>
    <SteamHeaderArtwork game={props.game} details={details} />
    <div className="ga-wide-shade" aria-hidden="true" />
    <header className="ga-wide-heading">
      <div className="ga-detail-heading-tools"><p className="ga-detail-eyebrow">{genreLabels(steam?.genres ?? props.game.genres).join(" · ")}</p>
        {hasTauriRuntime() && props.game.app_id ? <button className="ga-steam-refresh" type="button" title={t("uiActualizarDatosDeSteam")} aria-label={t("uiActualizarDatosDeSteam")} disabled={!details || detailState.refreshingSteam} onClick={() => void detailState.refreshSteam()}><RotateCw size={16} className={detailState.refreshingSteam ? "is-refreshing" : undefined} /></button> : null}
      </div>
      <h1 ref={titleRef} className="ga-wide-title">{props.game.name}</h1>
      <div className="ga-detail-facts"><span>{steam?.release_date ?? props.game.release_date ?? t("notReported")}</span><span>{installSize}</span><span>{platforms(details)}</span></div>
      <DetailPlayModes game={props.game} details={details} />
    </header>
    <div className="ga-wide-body">
      <nav className="ga-wide-tabs" role="tablist" aria-label={t("uiInformacionDelJuego")} aria-orientation="vertical">
        {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`ga-detail-tab-${tab.id}`} aria-selected={section === tab.id} aria-controls="ga-detail-pane" onClick={() => setSection(tab.id)}>{tab.label}</button>)}
      </nav>
      <div className="ga-wide-pane" role="tabpanel" id="ga-detail-pane" aria-labelledby={`ga-detail-tab-${section}`}>
        {section === "summary" ? <div className="ga-stack">
          <p className="ga-detail-lead">{description || (detailState.loading ? t("descriptionLoading") : t("descriptionUnavailable"))}</p>
          {detailState.loading ? <span role="status">{t("uiCargandoFichaDeSteam")}</span> : null}
          <div className="ga-wide-summary-facts">
            <div><span>{t("factDeveloper")}</span><strong>{steam?.developers?.join(" · ") || props.game.developers?.join(" · ") || t("notReported")}</strong></div>
            <div><span>{t("factRelease")}</span><strong>{steam?.release_date ?? props.game.release_date ?? t("notReported")}</strong></div>
            <div><span>{t("factSize")}</span><strong>{installSize}</strong></div>
          </div>
          {props.game.tags?.length ? <div className="ga-detail-tags">{props.game.tags.map(tag => <span key={tag}>{tag}</span>)}</div> : null}
          <ActiveDownloadFacts download={props.download} />
          {props.showcaseMode ? null : <AiReasonPanel game={props.game} />}
        </div> : null}
        {section === "description" && about ? <SteamRichText html={about} /> : null}
        {section === "more" ? <SteamFacts details={details} game={props.game} /> : null}
        {section === "requirements" ? <div className="ga-stack">
          {steam?.minimum_requirements ? <section><h3>{t("uiRequisitosMinimos")}</h3><SteamRichText html={steam.minimum_requirements} /></section> : null}
          {steam?.recommended_requirements ? <section><h3>{t("uiRequisitosRecomendados")}</h3><SteamRichText html={steam.recommended_requirements} /></section> : null}
        </div> : null}
        {section === "sources" ? sources === null ? <span role="status"><Loader2 className="spin" />{t("sourcesChecking")}</span> : <div className="ga-wide-source-list">{sources.map((source, index) => <div key={source.url} className={index === 0 ? "is-best" : ""}><strong>{source.title}</strong><span>{source.sourceName} · {source.size || t("downloadsSizeUnknown")}</span></div>)}</div> : null}
        {section === "coop" ? coopLoading ? <span role="status"><Loader2 className="spin" />{t("uiConsultandoCooperativo")}</span> : coop ? <CoopFacts data={coop} es={localeTag.startsWith("es")} /> : null : null}
      </div>
    </div>
    <aside className="ga-wide-side" aria-label={t("uiVideosYCapturas")}>
      <section className="ga-wide-rating" aria-label={t("uiValoracionDeUsuariosEn")}>
        <div className="ga-wide-rating-ring" role="progressbar" aria-label={t("uiValoracionDeUsuariosEn")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score == null ? undefined : Math.round(percent)}>
          <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="ga-wide-ring-track" cx="50" cy="50" r="42" /><circle className="ga-wide-ring-value" cx="50" cy="50" r="42" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - shownPercent / 100)} /></svg>
          <strong>{score == null ? "—" : `${Math.round(shownPercent)}%`}</strong>
        </div>
        <div className="ga-wide-rating-facts"><span>{t("steamReviewsLabel", { value: count ? t("steamReviewsCount", { count: count.toLocaleString(localeTag) }) : t("noScore") })}</span>
          {typeof recommendations === "number" ? <span>{t("factRecommendations")} · {recommendations.toLocaleString(localeTag)}</span> : null}
          {typeof metacritic === "number" ? <span>Metacritic · {metacritic}/100</span> : null}
        </div>
      </section>
      <div className="ga-wide-media"><DesktopDetailMedia game={props.game} details={details} /></div>
      <div ref={actionsRef} className="ga-detail-actions"><ActionButtons {...props} /><button type="button" className="ga-favorite" aria-label={t("uiMeGusta")} aria-pressed={props.preference === 1} onClick={() => props.onPreference(1)}><ThumbsUp size={22} fill={props.preference === 1 ? "currentColor" : "none"} /></button><button type="button" className="ga-favorite" aria-label={t("uiNoMeGusta")} aria-pressed={props.preference === -1} onClick={() => props.onPreference(-1)}><ThumbsDown size={19} /></button></div>
    </aside>
  </article>;
}
