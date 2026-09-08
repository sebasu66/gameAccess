from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps" / "desktop" / "src"


def git_blob(sha: str) -> str:
    return subprocess.check_output(["git", "cat-file", "blob", sha], cwd=ROOT, text=True)


def baseline_sha(path: str) -> str:
    data = json.loads((ROOT / "apps" / "desktop" / "quality-baseline.json").read_text(encoding="utf-8"))
    return data["legacyBlobShas"][path]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: expected source not found")
    return text.replace(old, new, 1)


# Start from the repository's handoff implementation so CSS/docs/tests stay aligned
# with the approved contract, then replace the two grandfathered controllers with a
# compatibility-oriented composition that does not enlarge legacy architecture debt.
subprocess.run([sys.executable, str(ROOT / "tools" / "dev" / "apply_desktop_detail_handoff.py")], cwd=ROOT, check=True)
subprocess.run([sys.executable, str(ROOT / "tools" / "dev" / "fix_desktop_detail_handoff_lint.py")], cwd=ROOT, check=True)

# LibraryRoom accumulated unrelated legacy orchestration. Restore the exact accepted
# baseline and make the bounded detail panel own desktop rich-detail/media loading.
room_path = SRC / "LibraryRoom.tsx"
room_path.write_text(git_blob(baseline_sha("src/LibraryRoom.tsx")).replace("\r\n", "\n"), encoding="utf-8")

# Keep all established selection/action helpers from the accepted baseline, but remove
# the superseded in-file detail renderer and re-export the focused implementation.
parts_path = SRC / "LibraryRoomParts.tsx"
parts = git_blob(baseline_sha("src/LibraryRoomParts.tsx")).replace("\r\n", "\n")
parts = parts.replace(
    'import { Download, Gamepad2, Loader2, Play, ThumbsDown, ThumbsUp, Volume2, VolumeX, XCircle } from "lucide-react";',
    'import { Download, Gamepad2, Loader2, Play, XCircle } from "lucide-react";',
)
parts = parts.replace(
    'import { downloadProgress, formatDownloadBytes, formatDownloadEta, formatDownloadSpeed, isTrackedDownload } from "./downloadManager";',
    'import { isTrackedDownload } from "./downloadManager";',
)
pattern = r'\ninterface MediaPanelProps \{.*?\ninterface CatalogPanelProps'
replacement = '\nexport { FeaturePanel } from "./LibraryDetailPanel";\n\ninterface CatalogPanelProps'
parts, count = re.subn(pattern, replacement, parts, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f"LibraryRoomParts detail extraction: expected one match, got {count}")
parts_path.write_text(parts, encoding="utf-8")

# Preserve desktop keyboard auto-follow after restoring LibraryRoom to its accepted
# baseline. The catalog component already owns both selectedIndex and the scroll ref,
# so this behavior belongs here and works for desktop/tablet without offsetParent bugs.
catalog_path = SRC / "DownloadCatalogPanel.tsx"
catalog = catalog_path.read_text(encoding="utf-8")
if 'selectionItemTopInScrollContainer' not in catalog:
    catalog = replace_once(
        catalog,
        'import { libraryArtworkCandidates } from "./libraryArtwork";\n',
        'import { libraryArtworkCandidates } from "./libraryArtwork";\nimport { calculateSelectionScrollTop, selectionItemTopInScrollContainer } from "./libraryNavigation";\n',
        "catalog navigation import",
    )
    marker = '  const [contextMenu, setContextMenu] = useState<OpenContextMenu>(null);\n\n'
    effect = '''  useEffect(() => {\n    const grid = props.gridRef.current;\n    const card = grid?.querySelector<HTMLElement>(".library-room-card.is-selected");\n    if (!grid || !card || props.selectedIndex < 0) return;\n    const gridRect = grid.getBoundingClientRect();\n    const cardRect = card.getBoundingClientRect();\n    const itemTop = selectionItemTopInScrollContainer({\n      scrollTop: grid.scrollTop,\n      viewportTop: gridRect.top,\n      itemTop: cardRect.top,\n    });\n    const nextTop = calculateSelectionScrollTop({\n      scrollTop: grid.scrollTop,\n      viewportHeight: grid.clientHeight,\n      itemTop,\n      itemHeight: cardRect.height,\n      padding: 8,\n    });\n    if (Math.abs(nextTop - grid.scrollTop) > 1) grid.scrollTo({ top: nextTop, behavior: "auto" });\n  }, [props.games.length, props.gridRef, props.selectedIndex]);\n\n'''
    catalog = replace_once(catalog, marker, marker + effect, "catalog selection follow")
    catalog_path.write_text(catalog, encoding="utf-8")

# Linux quality runners need to import ownership/provider modules without instantiating
# Windows UI Automation. The actual Windows switch path still imports pywinauto lazily.
steam_switch_path = ROOT / "apps" / "launcher" / "steam_switch.py"
steam_switch = steam_switch_path.read_text(encoding="utf-8")
steam_switch = steam_switch.replace("\nfrom pywinauto import Desktop\n", "\n")
if 'from pywinauto import Desktop\n\n    desktop = Desktop' not in steam_switch:
    steam_switch = replace_once(
        steam_switch,
        'def _steam_windows() -> Iterable:\n    """Return visible top-level windows that plausibly belong to Steam."""\n    desktop = Desktop(backend="uia")',
        'def _steam_windows() -> Iterable:\n    """Return visible top-level windows that plausibly belong to Steam."""\n    from pywinauto import Desktop\n\n    desktop = Desktop(backend="uia")',
        "lazy Windows UI import",
    )
steam_switch_path.write_text(steam_switch, encoding="utf-8")

# Focused desktop detail renderer. It accepts the legacy prop shape used by the accepted
# LibraryRoom baseline, but owns desktop selected-game detail loading and deterministic
# trailer -> screenshots sequencing. Display continues to use the legacy media contract.
detail_path = SRC / "LibraryDetailPanel.tsx"
detail_path.write_text(r'''import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  downloadProgress,
  formatDownloadBytes,
  formatDownloadEta,
  formatDownloadSpeed,
  isTrackedDownload,
} from "./downloadManager";
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
  return movies?.find((item) => item.highlight) ?? movies?.[0];
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
  return (
    <div className="library-room-actions glass-actions-row">
      {props.actions.map((action, index) => (
        <button
          type="button"
          key={`${action.kind}-${action.label}`}
          ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }}
          data-action={action.kind}
          title={action.reason ?? undefined}
          className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)}
          onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }}
          onClick={() => props.onAction(index)}
          disabled={action.disabled}
        >
          <span className="glass-action-icon">{action.icon}</span>
          <span className="glass-action-label">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function PreferenceButtons(props: Pick<FeaturePanelProps, "game" | "preference" | "onPreference">) {
  return (
    <div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>
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
  const movie = selectedMovie(details);
  const videoSrc = selectedVideo(movie);
  const images = useMemo(() => screenshotImages(details), [details]);
  const fallback = fallbackArtwork(game, details);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.68);
  const [paused, setPaused] = useState(reducedMotion);
  const [readyVideo, setReadyVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<DetailMediaSequenceState>(() => createDetailMediaSequence({ videoSrc, images, reducedMotion }));
  const currentImage = state.phase === "image" ? (state.images[state.imageIndex] ?? fallback) : fallback;
  const artwork = useCrossfadeArtwork(currentImage);
  const imagesKey = images.join("|");

  useEffect(() => {
    setReadyVideo(false);
    setPaused(reducedMotion);
    setState(createDetailMediaSequence({ videoSrc, images, reducedMotion }));
  }, [game.id, videoSrc, imagesKey, reducedMotion]);

  useEffect(() => {
    if (paused || state.phase !== "image" || reducedMotion || state.images.length === 0) return;
    const timer = window.setTimeout(() => setState((current) => afterDetailImage(current)), SCREENSHOT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [paused, reducedMotion, state.phase, state.imageIndex, state.images.length]);

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
    else void video.play().catch(() => setState((current) => disableDetailVideo(current)));
  }, [paused, state.phase, volume, muted]);

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

function DesktopDetailMedia({ game, details }: { game: CatalogGame; details: GameDetails | null }) {
  const model = useDesktopMedia(game, details);
  return (
    <div className="library-detail-media">
      <div className="library-room-feature-ambient" aria-hidden="true">{model.artwork.layers.map((source, index) => source ? <img key={`ambient-${index}-${source}`} className={index === model.artwork.activeLayer ? "is-active" : ""} src={source} alt="" draggable={false} /> : null)}</div>
      <div className="library-room-feature-media">
        {model.artwork.layers.map((source, index) => source ? <img key={`detail-${index}-${source}`} className={`library-room-hero-layer ${index === model.artwork.activeLayer ? "is-active" : ""}`} src={source} alt="" draggable={false} onError={() => model.setState((current) => removeFailedDetailImage(current, source))} /> : null)}
        {model.videoSrc && model.state.phase === "video" && model.state.videoAvailable ? <video key={`${game.id}-${model.videoSrc}`} ref={model.videoRef} className={`library-room-video ${model.readyVideo ? "is-ready" : ""}`} src={model.videoSrc} poster={model.fallback} autoPlay={!model.paused} muted={model.muted} playsInline preload="metadata" onCanPlay={() => { model.setReadyVideo(true); if (!model.paused) void model.videoRef.current?.play().catch(() => undefined); }} onEnded={() => model.setState((current) => afterDetailVideo(current))} onError={() => model.setState((current) => disableDetailVideo(current))} /> : null}
        <div className="library-room-feature-shade" />
        <MediaControls model={model} />
      </div>
    </div>
  );
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

function SteamFacts({ details }: { details: GameDetails | null }) {
  const steam = details?.steam;
  const facts = [
    ["Género", compactValue(steam?.genres)],
    ["Funciones Steam", compactValue(steam?.categories, 4)],
    ["Desarrollador", compactValue(steam?.developers, 2)],
    ["Publisher", compactValue(steam?.publishers, 2)],
    ["Lanzamiento", steam?.release_date || "No informado"],
    ["Plataformas", platforms(details)],
  ];
  return <dl className="library-room-game-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
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
  return <div className="library-room-active-download" aria-label="Descarga activa">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}{Number.isFinite(progress) ? <div className="library-room-progress-inline"><span style={{ width: `${progress}%` }} /><strong>{Math.round(progress)}%</strong></div> : null}</div>;
}

function ExtendedDetails({ details }: { details: GameDetails | null }) {
  const steam = details?.steam;
  const about = steam?.about_the_game ?? "";
  const minimum = steam?.minimum_requirements ?? "";
  const recommended = steam?.recommended_requirements ?? "";
  return (
    <div className="library-detail-extended" tabIndex={0} aria-label="Detalles extendidos del juego">
      {about ? <section className="library-room-copy-block"><h3>Acerca del juego</h3><SteamRichText html={about} /></section> : null}
      {steam?.categories?.length ? <section className="library-room-copy-block"><h3>Funciones de Steam</h3><p>{steam.categories.join(" · ")}</p></section> : null}
      {minimum || recommended ? <section className="library-room-requirements-block">{minimum ? <div><h3>Requisitos mínimos</h3><SteamRichText html={minimum} /></div> : null}{recommended ? <div><h3>Requisitos recomendados</h3><SteamRichText html={recommended} /></div> : null}</section> : null}
      {steam?.screenshots?.length ? <section className="library-room-gallery-block"><h3>Capturas</h3><div className="library-room-screenshots">{steam.screenshots.slice(0, 8).map((shot, index) => shot.full || shot.thumbnail ? <img key={shot.id ?? index} src={shot.full ?? shot.thumbnail} alt="" loading="lazy" /> : null)}</div></section> : null}
    </div>
  );
}

function DesktopFeature(props: FeaturePanelProps) {
  const detailState = useSelectedGameDetails({ surface: "desktop", selectedGameId: props.game.id, detailRequestedGameId: props.game.id, tabletDetailsOpen: true });
  const details = detailState.details;
  const description = plainText(details?.steam?.short_description);
  const summary = description || (detailState.loading ? "Cargando descripción de Steam…" : "Descripción no disponible");
  return (
    <aside className="library-room-feature">
      <section className="library-detail-essential" aria-label="Resumen esencial del juego">
        <DesktopDetailMedia game={props.game} details={details} />
        <div className="library-detail-essential-overlay" />
        <section className="library-room-first-row" aria-label="First row"><header className="library-room-overview"><h1>{props.game.name}</h1><p className="library-room-lead">{summary}</p>{detailState.loading ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando ficha de Steam…</span> : null}{!detailState.loading && detailState.error ? <span className="library-room-loading">Steam no respondió; podés seguir navegando.</span> : null}</header><div className="library-room-control-row"><ActionButtons {...props} /><PreferenceButtons {...props} /></div></section>
        <section className="library-room-second-row" aria-label="Second row"><SteamFacts details={details} /><div className="library-room-gameaccess-fact"><span>Copias GameAccess</span><strong>{props.game.copies_available} / {props.game.copies_total} disponibles</strong></div><ActiveDownloadFacts download={props.download} /></section>
      </section>
      <ExtendedDetails details={details} />
    </aside>
  );
}

function isDisplaySurface(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("surface") === "display";
}

export function FeaturePanel(props: FeaturePanelProps) {
  return isDisplaySurface() ? <LegacyDisplayFeature {...props} /> : <DesktopFeature {...props} />;
}
''', encoding="utf-8")

print("Desktop detail completion pass applied.")
