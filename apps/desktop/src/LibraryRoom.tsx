import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Gamepad2, Info, Loader2, Play, Volume2, VolumeX } from "lucide-react";

import { loadDetails } from "./api";
import { playUiSound } from "./uiSounds";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame, GameDetails } from "./types";

type DownloadMap = Record<number, SteamDownloadStatus>;
type FocusZone = "grid" | "actions";

interface LibraryRoomProps {
  games: CatalogGame[];
  downloads: DownloadMap;
  busy: boolean;
  onPlay: (game: CatalogGame) => void | Promise<void>;
  onDownload: (game: CatalogGame) => void | Promise<void>;
  onOpenDetails: (game: CatalogGame) => void;
  loading?: boolean;
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

function InstallStateBadge({ status, available }: { status?: SteamDownloadStatus; available: boolean }) {
  const installed = status?.state === "installed" || status?.installed === true;
  if (!installed || !available) return null;
  return <span className="library-install-state ready" title="Instalado · listo para jugar"><Play size={12} fill="currentColor" /></span>;
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
      try { await image.decode(); } catch { /* onload is enough on engines without decode */ }
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
    return () => { cancelled = true; image.onload = null; };
  }, [source]);

  return { layers, activeLayer };
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

  const selectedGame = games[selectedIndex] ?? games[0];
  const selectedGameId = selectedGame?.id;
  const selectedAppId = selectedGame?.app_id;
  const accountCount = useMemo(() => new Set(games.flatMap((game) => game.local_account_labels ?? [])).size, [games]);
  const download = selectedAppId ? downloads[selectedAppId] : undefined;
  const installed = download?.state === "installed" || download?.installed === true;
  const activeDownload = Boolean(download && ["requested", "preparing", "downloading"].includes(download.state));
  const hero = details?.steam?.screenshots?.[0]?.full || details?.steam?.background || details?.steam?.hero_image || selectedGame?.hero_image || selectedGame?.header_image || selectedGame?.capsule_image || undefined;
  const movie = details?.steam?.movies?.find((item) => item.highlight) || details?.steam?.movies?.[0];
  const videoSrc = movie?.mp4 || movie?.webm;
  const artwork = useCrossfadeArtwork(hero);
  const summary = details?.steam?.short_description || "Seleccionado de la biblioteca combinada de tus cuentas Steam.";

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
    if (!showcaseMode) { showcaseEnteredRef.current = false; return; }
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
    // Give each game time to breathe: video entries stay about 1m50s; still images 1m30s.
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
    try { video.currentTime = gameplayStart; } catch { /* metadata race */ }
    video.volume = videoVolume;
    video.muted = videoMuted;
    void video.play().catch(() => undefined);
  };

  const toggleVideoSound = () => {
    const nextMuted = !videoMuted;
    setVideoMuted(nextMuted);
    const video = videoRef.current;
    if (video) {
      video.muted = nextMuted;
      video.volume = videoVolume;
      if (!nextMuted) void video.play().catch(() => undefined);
    }
  };

  const activateAction = () => {
    if (!selectedGame) return;
    playUiSound("activate");
    if (actionIndex === 0 && installed && !busy && selectedGame.copies_available > 0) void onPlay(selectedGame);
    if (actionIndex === 1 && selectedGame.app_id && !installed && !activeDownload) void onDownload(selectedGame);
    if (actionIndex === 2) onOpenDetails(selectedGame);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    markActivity();
    if (!selectedGame || !games.length) return;
    const key = event.key.toLowerCase();
    if (focusZone === "actions") {
      if (key === "escape" || key === "s" || key === "arrowdown") { event.preventDefault(); returnToGrid(); return; }
      if (["a", "arrowleft", "w", "arrowup"].includes(key)) {
        event.preventDefault();
        const next = (actionIndex - 1 + 3) % 3;
        playUiSound("move");
        setActionIndex(next);
        actionRefs.current[next]?.focus({ preventScroll: true });
        return;
      }
      if (["d", "arrowright"].includes(key)) {
        event.preventDefault();
        const next = (actionIndex + 1) % 3;
        playUiSound("move");
        setActionIndex(next);
        actionRefs.current[next]?.focus({ preventScroll: true });
        return;
      }
      if (key === "enter") { event.preventDefault(); activateAction(); }
      return;
    }

    if (key === "enter") { event.preventDefault(); enterActions(); return; }
    if (key === "escape") { event.preventDefault(); return; }
    if (key === "a" || key === "arrowleft") {
      event.preventDefault();
      if (selectedIndex % columns === 0) enterActions(); else moveGrid(-1);
      return;
    }
    if (key === "d" || key === "arrowright") { event.preventDefault(); moveGrid(1); return; }
    if (key === "w" || key === "arrowup") { event.preventDefault(); moveGrid(-columns); return; }
    if (key === "s" || key === "arrowdown") { event.preventDefault(); moveGrid(columns); }
  };

  const actions = useMemo(() => {
    if (!selectedGame) return [];
    return [
      { label: installed ? "Jugar" : "No instalado", icon: busy ? <Loader2 className="spin" size={23} /> : <Play size={23} fill="currentColor" />, disabled: !installed || busy || selectedGame.copies_available <= 0 },
      { label: installed ? "Instalado" : activeDownload ? `${Math.round(download?.progress ?? 0)}%` : "Descargar", icon: activeDownload ? <Loader2 className="spin" size={23} /> : <Download size={23} />, disabled: !selectedGame.app_id || installed || activeDownload },
      { label: "Ficha completa", icon: <Info size={23} />, disabled: false },
    ];
  }, [activeDownload, busy, download?.progress, installed, selectedGame]);

  if (!selectedGame) {
    return (
      <section ref={rootRef} className="library-room focus-grid is-empty" tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={markActivity} aria-label="Biblioteca">
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
            <div className="library-room-empty-state"><Gamepad2 size={42} /><strong>{loading ? "Buscando juegos…" : "No hay juegos para mostrar"}</strong><span>{loading ? "La interfaz ya está lista; sólo estamos esperando los datos." : "Este es un estado válido y no bloquea GameAccess."}</span></div>
          </div>
        </section>
        <div className="library-room-hint"><span>NAVEGAR · WASD / FLECHAS</span><span>ENTRAR / ACTIVAR · ENTER</span><span>VOLVER · ESC</span></div>
      </section>
    );
  }

  return (
    <section ref={rootRef} className={`library-room focus-${focusZone} ${showcaseMode ? "is-showcase" : ""}`} tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={markActivity} aria-label="Biblioteca">
      <aside className="library-room-feature">
        <div className="library-room-feature-ambient" aria-hidden="true">
          {artwork.layers.map((source, index) => source ? <img key={`ambient-${index}-${source}`} className={index === artwork.activeLayer ? "is-active" : ""} src={source} alt="" draggable={false} /> : null)}
        </div>
        <div className="library-room-feature-media">
          {artwork.layers.map((source, index) => source ? <img key={`hero-${index}-${source}`} className={`library-room-hero-layer ${index === artwork.activeLayer ? "is-active" : ""}`} src={source} alt="" draggable={false} /> : null)}
          {videoSrc ? (
            <video
              key={videoSrc}
              ref={videoRef}
              className={`library-room-video ${readyVideoSrc === videoSrc ? "is-ready" : ""}`}
              src={videoSrc}
              poster={movie?.thumbnail}
              autoPlay
              muted={videoMuted}
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => startVideoPastIntro(event.currentTarget)}
              onCanPlay={(event) => { setReadyVideoSrc(videoSrc ?? null); void event.currentTarget.play().catch(() => undefined); }}
              onEnded={(event) => startVideoPastIntro(event.currentTarget)}
            />
          ) : null}
          <div className="library-room-feature-shade" />
          {videoSrc ? (
            <div className="library-room-media-controls" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" className="library-room-volume-toggle" onClick={toggleVideoSound} aria-label={videoMuted ? "Activar sonido" : "Silenciar video"} title={videoMuted ? "Activar sonido" : "Silenciar"}>
                {videoMuted || videoVolume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <input
                aria-label="Volumen del video"
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={videoMuted ? 0 : videoVolume}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setVideoVolume(value);
                  setVideoMuted(value <= 0);
                  const video = videoRef.current;
                  if (video) { video.volume = value; video.muted = value <= 0; if (value > 0) void video.play().catch(() => undefined); }
                }}
              />
            </div>
          ) : null}
        </div>
        <div className="library-room-feature-copy">
          <span className="eyebrow">{showcaseMode ? "MODO VITRINA" : "TU BIBLIOTECA"}</span>
          <h1>{selectedGame.name}</h1>
          <p>{summary}</p>
          {loadingDetails ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando medios de Steam…</span> : null}
          <div className="library-room-actions" role="group" aria-label="Acciones del juego seleccionado">
            {actions.map((action, index) => (
              <button
                type="button"
                key={action.label}
                ref={(node) => { actionRefs.current[index] = node; }}
                data-action={index === 0 ? "play" : index === 1 ? "download" : "details"}
                className={`library-room-action ${focusZone === "actions" && actionIndex === index ? "is-selected" : ""}`}
                onFocus={() => { setFocusZone("actions"); setActionIndex(index); }}
                onClick={() => {
                  setActionIndex(index);
                  if (!action.disabled) {
                    playUiSound("activate");
                    if (index === 0) void onPlay(selectedGame);
                    else if (index === 1) void onDownload(selectedGame);
                    else onOpenDetails(selectedGame);
                  }
                }}
                disabled={action.disabled}
              >
                {action.icon}<strong>{action.label}</strong>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="library-room-catalog">
        <header className="library-room-heading"><small>{games.length} juegos{accountCount ? ` · ${accountCount} cuenta${accountCount === 1 ? "" : "s"}` : ""} · WASD / FLECHAS</small></header>
        <div ref={gridRef} className="library-room-grid">
          {games.map((game, index) => (
            <button
              type="button"
              key={game.id}
              className={`library-room-card ${index === selectedIndex ? "is-selected" : ""}`}
              onMouseEnter={() => {
                markActivity();
                if (index !== selectedIndex) playUiSound("move");
                setSelectedIndex(index);
              }}
              onClick={() => { setSelectedIndex(index); setFocusZone("grid"); rootRef.current?.focus({ preventScroll: true }); }}
              aria-current={index === selectedIndex ? "true" : undefined}
              aria-label={`${index === selectedIndex ? "Seleccionado: " : "Seleccionar "}${game.name}`}
              tabIndex={-1}
            >
              <span className="library-room-card-art"><SteamCover game={game} /><InstallStateBadge status={game.app_id ? downloads[game.app_id] : undefined} available={game.copies_available > 0} /></span>
            </button>
          ))}
        </div>
      </section>

      <div className="library-room-hint"><span>NAVEGAR · WASD / FLECHAS</span><span>ENTRAR / ACTIVAR · ENTER</span><span>VOLVER · ESC</span></div>
    </section>
  );
}
