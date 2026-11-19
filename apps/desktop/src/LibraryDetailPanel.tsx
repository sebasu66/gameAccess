import { genreLabels } from "./libraryGenres";
import { ChevronDown, ChevronUp, Download, ExternalLink, Store } from "lucide-react";
import { isSteamOwned } from "./steamLibrary";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { useLibraryEntry } from "./libraryScan";
import { notify } from "./toasts";
import { openSteamStore } from "./native";
import { usePluginReady } from "./usePluginReady";
import CooptimusDetails, { CoopFacts, loadCooptimusDetails, type CoopDetails } from "./CooptimusDetails";
import { AiReasonPanel } from "./AiPicks";
import { aiWhy } from "./aiSuggestions";
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
import type { CSSProperties, ReactNode, RefObject } from "react";
import { Check, Clock, Cpu, FileText, Gamepad2, Globe, Image as ImageIcon, Info, Loader2, Maximize2, Minimize2, Monitor, MoreHorizontal, Network, Pause, Play, RotateCw, Sparkles, Tags, ThumbsDown, ThumbsUp, Trophy, User, Users, Volume2, VolumeX, X } from "lucide-react";
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
import DetailDownloads from "./DetailDownloads";
import { GaPadButton } from "./components/ga/PadButton";
import { DetailEditorial } from "./DetailEditorial";
import { GameLogo, SheetPanel, SheetRows, SheetScore, AskDetailAi, useDetailAiReady, useMoreLikeThis, RelatedGames } from "./DetailSheet";

import GaTabs from "./GaTabs";
import { GaButton } from "./components/ga/Buttons";

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
    // Steam's own headings get one class of ours, so the detail can style them apart from its paragraphs.
    if (/^H[1-4]$/.test(node.tagName)) node.setAttribute("class", "steam-heading");
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

function useReducedMotion(): boolean { return false; }

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
  /** The new shell's detail (EN10) carries its own close and options, at the title's height. */
  onClose?: () => void;
  closeRef?: RefObject<HTMLButtonElement>;
  onMore?: (anchor: DOMRect) => void;
  moreOpen?: boolean;
  /** Opens another game's detail (the AI's "more like this" answers). */
  onOpenGame?: (game: CatalogGame) => void;
}

/** The new detail's keys (Seba, 2026-11-17; docs/GUI_DESIGN.md §4.42): pads with a black hairline and a soft shadow
 * behind their content, in the detail's pad colour (set on `.ga-wide-actions`). */
const PAD_INK = { ink: "outlined", halo: true } as const;
type PadLook = { className?: string };

function actionClass(action: LibraryAction, selected: boolean): string {
  const kind = action.kind === "play" ? "play" : action.kind === "manage" ? "manage" : "download";
  return `glass-action ${kind} ${selected ? "is-selected" : ""}`.trim();
}

function SteamStoreButton({ game, primary, className, buttonRef, onFocus, pad }: { game: CatalogGame; primary?: boolean; className?: string; buttonRef?: (node: HTMLButtonElement | null) => void; onFocus?: () => void; pad?: PadLook }) {
  const { t } = useI18n();
  const appId = game.app_id ?? 0;
  if (!appId) return null;
  if (pad) return <GaPadButton {...PAD_INK} lit={primary} className={pad.className} ref={buttonRef} onFocus={onFocus} data-action="steam" label={t("detailViewOnSteam")}
    icon={<Store />} onClick={() => void openSteamStore(appId)}>{primary ? t("detailViewOnSteam") : null}</GaPadButton>;
  return <button type="button" ref={buttonRef} onFocus={onFocus} data-action="steam" title={t("detailViewOnSteam")} aria-label={t("detailViewOnSteam")}
    className={primary ? className : "source-options-toggle steam-store-small"} onClick={() => void openSteamStore(appId)}>
    {primary ? <><span className="glass-action-icon"><Store size={23} /></span><span className="glass-action-label">{t("detailViewOnSteam")}</span></> : <Store size={20} />}
  </button>;
}

/** A Steam game one of the player's accounts owns is installed by Steam, not by a download source. */
function SteamInstallButton({ game, className, buttonRef, onFocus, pad }: { game: CatalogGame; className: string; buttonRef: (node: HTMLButtonElement | null) => void; onFocus: () => void; pad?: PadLook }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const install = async () => {
    setBusy(true);
    // The download queue hands it to Steam's own install window and follows it (DigitalCatalog.download).
    try { await digitalCatalogService.download(game); notify(t("steamInstallHandedOff", { name: game.name }), { tone: "success" }); }
    catch (error) { notify(t("steamInstallError", { error: error instanceof Error ? error.message : String(error) }), { tone: "error" }); }
    finally { setBusy(false); }
  };
  if (pad) return <GaPadButton {...PAD_INK} lit className={pad.className} ref={buttonRef} onFocus={onFocus} data-action="steam-install" disabled={busy} onClick={() => void install()}
    label={t("steamInstallMenu")} icon={busy ? <Loader2 className="spin" /> : <Download />}>{t("steamInstallMenu")}</GaPadButton>;
  return <button type="button" ref={buttonRef} onFocus={onFocus} data-action="steam-install" className={className} disabled={busy} onClick={() => void install()}>
    <span className="glass-action-icon">{busy ? <Loader2 className="spin" size={23} /> : <Download size={23} />}</span>
    <span className="glass-action-label">{t("steamInstallMenu")}</span>
  </button>;
}

/** In the new detail a direct download starts only in its Downloads tab: the main button takes the player there. */
type DownloadsTab = { count: number | null; open: () => void };

function ActionButtons(props: FeaturePanelProps & { downloadsTab?: DownloadsTab; pad?: boolean }) {
  if (props.pad) return <PadActions {...props} />;
  return <GlassActions {...props} />;
}

function GlassActions(props: FeaturePanelProps & { downloadsTab?: DownloadsTab }) {
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
      : action.kind === "download" && props.downloadsTab && props.downloadsTab.count === 0
      ? <SteamStoreButton key="steam" game={props.game} primary className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)} buttonRef={node => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} />
      : action.kind === "download" && props.downloadsTab
      ? <button type="button" key="downloads-tab" data-action="download" disabled={action.disabled || props.downloadsTab.count === null}
        ref={node => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }}
        className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)}
        onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} onClick={props.downloadsTab.open}>
        <span className="glass-action-icon">{props.downloadsTab.count === null ? <Loader2 size={23} className="spin" /> : <Download size={23} />}</span>
        <span className="glass-action-label">{props.downloadsTab.count === null ? t("sourcesChecking") : t("detailSeeDownloads", { count: props.downloadsTab.count })}</span>
      </button>
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
  {(pluginReady || props.actions.some(action => action.kind === "play")) && props.downloadsTab?.count !== 0 && <SteamStoreButton game={props.game} />}
  </div>;
}

/** The detail's actions as pad keys: the same choices as GlassActions. */
function PadActions(props: FeaturePanelProps & { downloadsTab?: DownloadsTab }) {
  const { t } = useI18n();
  const steamOwned = isSteamOwned(useLibraryEntry(props.game.app_id ?? undefined));
  const pluginReady = usePluginReady() === true;
  return <div className="library-room-actions">
    {props.actions.map((action, index) => {
      const selected = props.focusZone === "actions" && props.actionIndex === index;
      const look = { className: selected ? "is-selected" : undefined };
      const ref = (node: HTMLButtonElement | null) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; };
      const focus = () => { props.setFocusZone("actions"); props.setActionIndex(index); };
      if (action.kind === "download") return steamOwned ? <SteamInstallButton key="steam-install" game={props.game} className="" pad={look} buttonRef={ref} onFocus={focus} /> : null;
      const text = action.kind === "play" ? t("downloadsPlay") : action.label;
      return <GaPadButton {...PAD_INK} lit={action.kind === "play"} key={action.kind} ref={ref} onFocus={focus} {...look} data-action={action.kind}
        title={action.reason ?? text} disabled={action.disabled} onClick={() => props.onAction(index)} label={text} icon={action.icon}>{text}</GaPadButton>;
    })}
    <SteamStoreButton game={props.game} pad={{}} />
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
      <button type="button" onClick={toggle} aria-label={model.paused ? t("mediaResume") : t("mediaPause")} title={model.paused ? t("mediaResume") : t("mediaPause")}>{model.paused ? <Play size={16} /> : <Pause size={16} />}</button>
      {model.videoSrc ? <><button type="button" onClick={() => model.setMuted((current) => !current)} aria-label={model.muted ? t("mediaUnmute") : t("mediaMute")} title={model.muted ? t("mediaUnmute") : t("mediaMute")}>{model.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><input aria-label={t("uiVolumenDelVideo")} type="range" min="0" max="1" step="0.02" value={model.muted ? 0 : model.volume} onChange={(event) => { const next = Number(event.currentTarget.value); model.setVolume(next); model.setMuted(next <= 0); }} /></> : null}
      {onExpand ? <button type="button" className="ga-media-expand" onClick={onExpand} aria-pressed={expanded} aria-label={expanded ? t("mediaRestore") : t("mediaMaximize")} title={expanded ? t("mediaRestore") : t("mediaMaximize")}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button> : null}
    </div>
  );
}

/**
 * The trailer and screenshots fill the screen (the browser's full screen, Seba 2026-11-17: the box grown inside the
 * detail clipped and lost its controls) and come back with Escape, the same button or a double click. Where full
 * screen is refused, the media box grows over the detail window instead (Flip) and Escape returns it without closing
 * the detail.
 */
function useExpandedMedia() {
  const [expanded, setExpanded] = useState(false);
  const flipState = useRef<Flip.FlipState | null>(null);
  const toggle = () => {
    const media = document.querySelector<HTMLElement>(".ga-wide-media .library-room-feature-media, .ga-detail-gallery .library-room-feature-media");
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return; }
    const grow = () => {
      flipState.current = media && motionOk() ? Flip.getState(media) : null;
      setExpanded(current => !current);
    };
    if (!expanded && media?.requestFullscreen) {
      // Refused, or no answer at all (a window in the background): it grows over the detail instead.
      let settled = false;
      const fallback = window.setTimeout(() => { if (!settled && !document.fullscreenElement) { settled = true; grow(); } }, 500);
      media.requestFullscreen().then(() => { settled = true; window.clearTimeout(fallback); }, () => { window.clearTimeout(fallback); if (!settled) { settled = true; grow(); } });
      return;
    }
    grow();
  };
  useEffect(() => {
    const changed = () => setExpanded(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => { document.removeEventListener("fullscreenchange", changed); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
  }, []);
  useEffect(() => {
    const state = flipState.current;
    flipState.current = null;
    if (state) Flip.from(state, { duration: .5, ease: "expo.inOut", absolute: false, zIndex: 40 });
    // In full screen the browser takes Escape itself.
    if (!expanded || document.fullscreenElement) return;
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

/** `shots`: how many screenshots sit beside the trailer (the file sheet shows more on a wide screen and hides the rest in CSS). */
function DesktopDetailMedia({ game, details, shots = 4 }: { game: CatalogGame; details: GameDetails | null; shots?: number }) {
  const { t } = useI18n();
  const model = useDesktopMedia(game, details);
  const { expanded, toggle } = useExpandedMedia();
  return (
    <div className={`library-detail-media${expanded ? " is-expanded" : ""}`}>
      <div className="library-room-feature-ambient" aria-hidden="true">{model.artwork.layers.map((source, index) => source ? <img key={`ambient-${index}-${source}`} className={index === model.artwork.activeLayer ? "is-active" : ""} src={source} alt="" draggable={false} /> : null)}</div>
      <div className="library-room-feature-media" onDoubleClick={toggle} onClick={event => { if (model.state.phase === "image" && !expanded && !(event.target as HTMLElement).closest("button")) toggle(); }}>
        {model.artwork.layers.map((source, index) => source ? <img key={`detail-${index}-${source}`} className={`library-room-hero-layer ${index === model.artwork.activeLayer ? "is-active" : ""}`} src={source} alt="" draggable={false} onError={() => model.setState((current) => removeFailedDetailImage(current, source))} /> : null)}
        {model.videoSrc && model.state.phase === "video" && model.state.videoAvailable ? <video key={`${game.id}-${model.videoSrc}`} ref={model.videoRef} className={`library-room-video ${model.readyVideo ? "is-ready" : ""}`} poster={model.fallback} autoPlay={!model.paused} muted={model.muted} playsInline preload="metadata" onCanPlay={() => { model.setReadyVideo(true); if (!model.paused) void model.videoRef.current?.play().catch(() => undefined); }} onEnded={() => model.setState((current) => afterDetailVideo(current))} onError={() => model.setState((current) => disableDetailVideo(current))} /> : null}
        <div className="library-room-feature-shade" />
        {model.videoSrc && (model.paused || model.state.phase !== "video") ? <button type="button" className="ga-media-play" aria-label={t("uiReproducirTrailer")} onClick={() => { model.setState(current => ({ ...current, phase: "video", videoAvailable: true })); model.setPaused(false); }}><Play size={48} fill="currentColor" strokeWidth={0} /></button> : null}
        <span className="ga-media-badge">{t("uiTrailerYCapturas")}</span>
        <span className="ga-media-caption"><ImageIcon aria-hidden="true" />{model.state.phase === "video" ? t("mediaTrailerCaption") : t("mediaShotsCaption")}</span>
        <MediaControls model={model} expanded={expanded} onExpand={toggle} />
      </div>
      <div className="ga-media-thumbnails">{model.state.images.slice(0, shots).map((source, index) => <button type="button" key={source} aria-label={t("mediaShotView", { n: index + 1 })} aria-pressed={model.state.phase === "image" && model.state.imageIndex === index} onClick={() => { model.setPaused(true); model.setState(current => ({ ...current, phase: "image", imageIndex: index })); if (!expanded) toggle(); }}><img src={source} alt="" /></button>)}</div>
      <div className="ga-media-bottom"><span><ImageIcon aria-hidden="true" />{t("mediaShotCount", { count: model.state.images.length })}</span><span className="ga-media-pagination" aria-hidden="true">{model.state.images.slice(0, 4).map((source, index) => <i key={source} className={model.state.imageIndex === index ? "is-active" : ""} />)}</span></div>
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
function DetailPlayModes({ game, details, lead }: { game: CatalogGame; details: GameDetails | null; lead?: ReactNode }) {
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
  return <div className="ga-detail-modes">{lead}{modes.filter(mode => mode.visible).map(({ key, label, Icon }) => <span key={key}><Icon aria-hidden="true" />{label}</span>)}</div>;
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

/** `edition: false` leaves out what the new detail already shows under its title or in its rating (EN10). */
function SteamFacts({ details, game, edition = true }: { details: GameDetails | null; game: CatalogGame; edition?: boolean }) {
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
  const shown = edition ? facts : facts.filter(([label, value]) => value !== t("notReported")
    && ![t("factSize"), t("factGenre"), t("factUserRating"), t("factRecommendations"), t("factDeveloper"), t("factRelease"), t("factPlatforms"), "Metacritic"].includes(label));
  if (!shown.length) return null;
  return <dl className="library-room-game-facts">{shown.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
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

type DetailSection = "description" | "about" | "details" | "ai" | "coop" | "downloads";
/** The summary shows this many tags; the rest are counted. */

const GAUGE_SEGMENTS = 44;

/** The Steam reviews as a gauge of segments that light up to the share of positive ones (EN10): compact, the media column's width. */
/** How long ago, in the player's language ("hace 3 días"). */
function sinceText(iso: string | undefined, localeTag: string): string | null {
  const when = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(when)) return null;
  const days = Math.round((when - Date.now()) / 86_400_000);
  const format = new Intl.RelativeTimeFormat(localeTag, { numeric: "auto" });
  return Math.abs(days) >= 30 ? format.format(Math.round(days / 30), "month") : format.format(days, "day");
}

/** The Escena game detail, with optional downloads and AI in the side column. */
function WideDetail(props: FeaturePanelProps) {
  const { t, localeTag } = useI18n();
  const detailState = useSelectedGameDetails({ selectedGameId: props.game.id, localSteamAppId: props.game.app_id, knownGame: props.game });
  const details = detailState.details;
  const steam = details?.steam;
  const about = steam?.about_the_game || steam?.detailed_description || "";
  const description = plainText(steam?.short_description) || plainText(props.game.short_description);
  const installSize = useInstallSize(props.game.app_id);
  const entry = useLibraryEntry(props.game.app_id ?? undefined);
  const steamOwned = isSteamOwned(entry);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const downloadsRef = useRef<HTMLElement>(null);
  const pluginReady = usePluginReady() === true;
  const playable = props.actions.some(action => action.kind === "play");
  const [sources, setSources] = useState<PluginSource[] | null>(null);
  const [coop, setCoop] = useState<CoopDetails | null>(null);
  const [aiSeen] = useState(() => !props.showcaseMode && Boolean(aiWhy(props.game.id)));
  const aiReady = useDetailAiReady();
  const canAskAi = !props.showcaseMode && aiReady;
  const [aiOpen, setAiOpen] = useState(false);
  const showAi = canAskAi && aiOpen;
  const similar = useMoreLikeThis(props.game);
  const related = similar.state?.picks ?? [];
  const aiPanelId = `ga-detail-ai-${props.game.id}`;
  useMagneticButtons(actionsRef);

  useEffect(() => {
    if (!pluginReady || playable) { setSources(null); return; }
    let active = true;
    setSources(null);
    void getPluginSources(props.game).then(value => { if (active) setSources(value); }).catch(() => { if (active) setSources([]); });
    return () => { active = false; };
  }, [pluginReady, playable, props.game]);

  useEffect(() => {
    if (props.showcaseMode || !props.game.app_id) { setCoop(null); return; }
    let active = true;
    setCoop(null);
    void loadCooptimusDetails(props.game.app_id, props.game.name).then(value => {
      if (active) setCoop(value?.state === "ready" ? value : null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [props.game.app_id, props.game.name, props.showcaseMode]);

  const moveParallax = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    stageRef.current?.style.setProperty("--ga-detail-pointer-x", String((event.clientX - bounds.left) / bounds.width - .5));
    stageRef.current?.style.setProperty("--ga-detail-pointer-y", String((event.clientY - bounds.top) / bounds.height - .5));
  };
  const resetParallax = () => {
    stageRef.current?.style.setProperty("--ga-detail-pointer-x", "0");
    stageRef.current?.style.setProperty("--ga-detail-pointer-y", "0");
  };

  // A title written out (no logo) fills its place on one line: it shrinks down to its least size.
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title || title.classList.contains("has-logo")) return;
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

  const showDownloads = pluginReady && !playable && (sources === null || sources.length > 0);
  const rated = details ?? props.game;
  const score = typeof rated.steam_review_score === "number" ? Math.round(rated.steam_review_score) : null;
  const metacritic = steam?.metacritic?.score ?? props.game.metacritic_score ?? null;
  const criticUrl = /^https:\/\//.test(steam?.metacritic?.url ?? "") ? steam?.metacritic?.url : undefined;
  const inLibrary = Boolean(entry) || playable;
  const [reading, setReading] = useState(false);
  useEffect(() => setReading(false), [props.game.id]);
  const developer = steam?.developers?.[0] || props.game.developers?.[0] || "";
  const release = steam?.release_date ?? props.game.release_date ?? "";
  const year = /\d{4}/.exec(release)?.[0] ?? "";
  const since = sinceText(entry?.last_played, localeTag);
  const shownSize = installSize === t("notReported") && sources?.[0]?.size ? sources[0].size : installSize;
  const genres = genreLabels(steam?.genres ?? props.game.genres);
  const categories = (steam?.categories ?? props.game.categories ?? []).map(normalizeSearchText);
  const controller = categories.some(value => value.includes("full controller") || value.includes("total con el control")) ? t("detailSheetControllerFull")
    : categories.some(value => value.includes("partial controller") || value.includes("parcial con el control")) ? t("detailSheetControllerPartial") : "";
  const languages = (plainText(steam?.supported_languages) || "").replace(/\*/g, "").split(/,\s*/).map(value => value.trim()).filter(Boolean);
  const requirements = steam?.minimum_requirements || steam?.recommended_requirements || "";
  const tags = props.game.tags ?? [];
  const sized = shownSize !== t("notReported") && shownSize !== t("sizeChecking") ? ` (${shownSize})` : "";
  const rows = [
    { icon: <Monitor />, label: t("factPlatforms"), value: platforms(details) },
    { icon: <Download />, label: t("detailSheetState"), value: <><i className={playable ? "ga-sheet-dot is-on" : "ga-sheet-dot"} />{(playable ? t("detailEdReady") : t("detailEdNotInstalled")) + sized}</> },
    ...(controller ? [{ icon: <Gamepad2 />, label: t("detailSheetController"), value: controller }] : []),
    ...(steam?.achievement_count ? [{ icon: <Trophy />, label: t("factAchievements"), value: String(steam.achievement_count) }] : []),
    ...(languages.length ? [{ icon: <Globe />, label: t("factLanguages"), value: languages.length > 3 ? `${languages.slice(0, 3).join(", ")} +${languages.length - 3}` : languages.join(", ") }] : []),
    ...(props.game.app_id ? [{ icon: <Info />, label: t("infoAppId"), value: String(props.game.app_id) }] : []),
  ].filter(row => row.value && row.value !== t("notReported"));
  const extras = showAi || showDownloads;
  const requirementsContent = requirements ? <SteamRichText html={requirements} /> :
    <ul className="ga-sheet-checks">{tags.slice(0, 12).map(tag => <li key={tag}><Check aria-hidden="true" />{tag}</li>)}</ul>;
  const requirementsLabel = requirements ? t("detailSheetRequirements") : t("uiEtiquetas");
  const detailsContent = <SheetRows rows={rows} />;
  const downloadsTab = pluginReady && !playable ? { count: sources === null ? null : sources.length, open: () => { setAiOpen(false); requestAnimationFrame(() => downloadsRef.current?.scrollIntoView({ block: "nearest" })); } } : undefined;

  return <article ref={stageRef} className={`ga-game-detail ga-game-detail-wide is-sheet${extras ? " has-extras" : ""}${reading ? " is-reading" : ""}`} onPointerMove={moveParallax} onPointerLeave={resetParallax}>
    <div className="ga-sheet-main">
      <div className="ga-sheet-stage" aria-hidden="true"><SteamHeaderArtwork game={props.game} details={details} /><div className="ga-sheet-shade" /><DetailEditorial /></div>
      <div className="ga-sheet-bar">
        <nav className="ga-sheet-path" aria-label={t("detailSheetPath")}>
          <Play aria-hidden="true" /><span>{entry ? t("navModeLibrary") : t("navModeCatalog")}</span>
          {genres[0] ? <><i aria-hidden="true">/</i><span>{genres[0]}</span></> : null}
          <i aria-hidden="true">/</i><b>{props.game.name}</b>
        </nav>
        <div className="ga-sheet-tools">
          {hasTauriRuntime() && props.game.app_id ? <button className="ga-steam-refresh" type="button" title={t("uiActualizarDatosDeSteam")} aria-label={t("uiActualizarDatosDeSteam")} disabled={!details || detailState.refreshingSteam} onClick={() => void detailState.refreshSteam()}><RotateCw className={detailState.refreshingSteam ? "is-refreshing" : undefined} aria-hidden="true" /></button> : null}
          {props.onMore ? <button type="button" className="ga-wide-more" aria-label={t("moreOptionsForAria", { name: props.game.name })} aria-haspopup="menu" aria-expanded={Boolean(props.moreOpen)} onClick={event => props.onMore?.(event.currentTarget.getBoundingClientRect())}><MoreHorizontal aria-hidden="true" /></button> : null}
          {props.onClose ? <button ref={props.closeRef} type="button" className="ga-wide-close" aria-label={t("uiCerrarDetalles")} onClick={props.onClose}><X aria-hidden="true" /></button> : null}
        </div>
      </div>
      <div className="ga-sheet-info">
        <header className="ga-sheet-hero">
          {developer ? <p className="ga-sheet-maker">{developer}</p> : null}
          <GameLogo appId={props.game.app_id} name={props.game.name} titleRef={titleRef} />
        </header>
        <div className="ga-sheet-summary">
          <DetailPlayModes game={props.game} details={details} lead={inLibrary ? <span className="ga-sheet-owned"><Check aria-hidden="true" />{t("detailSheetInLibrary")}</span> : null} />
          {genres.length || year ? <p className="ga-sheet-genres">{[...genres.slice(0, 3), year].filter(Boolean).join(" · ")}</p> : null}
          <p className="ga-sheet-lead">{description || (detailState.loading ? t("descriptionLoading") : t("descriptionUnavailable"))}</p>
        </div>
        <div className="ga-sheet-rating">
          {score != null ? <SheetScore value={score} percent label={rated.steam_review_count ? t("detailSheetSteamScoreCount", { count: new Intl.NumberFormat(localeTag).format(rated.steam_review_count) }) : t("detailSheetSteamScore")} source="steam" />
            : metacritic != null ? <SheetScore value={metacritic} percent={false} label={t("detailSheetMetascore")} source="metacritic" /> : null}
          {score != null && metacritic != null ? (criticUrl
            ? <a className="ga-sheet-critic" href={criticUrl} target="_blank" rel="noopener noreferrer" title={t("detailSheetCriticOpen")}>{t("detailSheetCritic", { score: metacritic })}<ExternalLink aria-hidden="true" /></a>
            : <span className="ga-sheet-critic">{t("detailSheetCritic", { score: metacritic })}</span>) : null}
          <p className="ga-sheet-played"><Clock aria-hidden="true" />{since ? t("detailSheetPlayedOn", { when: since }) : t("detailSheetNeverPlayed")}</p>
        </div>
        <div ref={actionsRef} className="ga-wide-actions"><ActionButtons {...props} pad downloadsTab={downloadsTab} />
          <GaPadButton {...PAD_INK} toggle lit={props.preference === 1} label={t("uiMeGusta")} icon={<ThumbsUp fill="currentColor" />} onClick={() => props.onPreference(1)} />
          <GaPadButton {...PAD_INK} toggle lit={props.preference === -1} label={t("uiNoMeGusta")} icon={<ThumbsDown fill="currentColor" />} onClick={() => props.onPreference(-1)} />
          {canAskAi ? <GaPadButton {...PAD_INK} toggle lit={showAi} label={t("detailSheetConsultAi")} icon={<Sparkles />}
            aria-expanded={showAi} aria-controls={showAi ? aiPanelId : undefined} onClick={() => setAiOpen(open => !open)}>{t("detailSheetConsultAi")}</GaPadButton> : null}
        </div>
      </div>
      <section className="ga-sheet-media ga-wide-media" aria-label={t("uiVideosYCapturas")}><DesktopDetailMedia game={props.game} details={details} shots={6} /></section>
      <div className="ga-sheet-panels">
        <SheetPanel icon={<FileText />} title={t("detailSheetDescription")} className="is-description"
          action={<button type="button" className="ga-sheet-fold" aria-expanded={reading} aria-label={reading ? t("detailSheetReadLess") : t("detailSheetReadMore")} title={reading ? t("detailSheetReadLess") : t("detailSheetReadMore")} onClick={() => { const stage = stageRef.current?.querySelector<HTMLElement>(".ga-sheet-stage"); if (!reading && stage) stageRef.current?.style.setProperty("--ga-sheet-stage-h", `${stage.offsetHeight}px`); setReading(open => !open); }}>{reading ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}</button>}>
          {about ? <SteamRichText html={about} /> : <p className="ga-sheet-copy">{detailState.loading ? t("descriptionLoading") : t("descriptionUnavailable")}</p>}
        </SheetPanel>
        <SheetPanel icon={requirements ? <Cpu /> : <Tags />} title={requirementsLabel} className="is-list">
          {related.length && props.onOpenGame ? <GaTabs label={requirementsLabel} tabs={[
            { id: "requirements", label: requirementsLabel, content: requirementsContent },
            { id: "related", label: t("detailSheetRelated"), content: <RelatedGames picks={related} onOpenGame={props.onOpenGame} /> },
          ]} /> : requirementsContent}
        </SheetPanel>
        <SheetPanel icon={<Info />} title={t("detailTabDetails")}>
          {coop ? <GaTabs label={t("detailTabDetails")} tabs={[
            { id: "details", label: t("detailTabDetails"), content: detailsContent },
            { id: "coop", label: t("detailTabCoop"), content: <CoopFacts data={coop} es={localeTag.startsWith("es")} /> },
          ]} /> : detailsContent}
        </SheetPanel>
      </div>
    </div>
    {extras ? <aside className={showAi ? "ga-sheet-extras is-ai-open" : "ga-sheet-extras"} id={showAi ? aiPanelId : undefined} aria-label={t("detailSheetExtras")}>
      {showAi ? <SheetPanel icon={<Sparkles />} title={t("detailSheetConsultAi")} className="is-ai"
        action={showDownloads ? <GaButton onClick={() => setAiOpen(false)}>{t("downloadsTitle")}</GaButton> : undefined}>
        {aiSeen ? <AiReasonPanel game={props.game} /> : null}
        <AskDetailAi game={props.game} similar={similar} canShowRelated={Boolean(props.onOpenGame)} />
      </SheetPanel> : null}
      {showDownloads ? <div hidden={showAi}><SheetPanel panelRef={downloadsRef} icon={<Download />} title={t("downloadsTitle")}><DetailDownloads game={props.game} sources={sources} compact /></SheetPanel></div> : null}
    </aside> : null}
  </article>;
}
