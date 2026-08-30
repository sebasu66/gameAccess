import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Gamepad2, Info, Loader2, Play } from "lucide-react";

import { loadDetails } from "./api";
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
}

export default function LibraryRoom({ games, downloads, busy, onPlay, onDownload, onOpenDetails }: LibraryRoomProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focusZone, setFocusZone] = useState<FocusZone>("grid");
  const [actionIndex, setActionIndex] = useState(0);
  const [columns, setColumns] = useState(4);
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const selectedGame = games[selectedIndex] ?? games[0];
  const download = selectedGame?.app_id ? downloads[selectedGame.app_id] : undefined;
  const installed = download?.state === "installed" || download?.installed === true;
  const activeDownload = Boolean(download && ["requested", "preparing", "downloading"].includes(download.state));
  const hero = details?.steam?.background || details?.steam?.hero_image || selectedGame?.hero_image || selectedGame?.header_image || selectedGame?.capsule_image || undefined;
  const movie = details?.steam?.movies?.find((item) => item.highlight) || details?.steam?.movies?.[0];
  const summary = details?.steam?.short_description || "Seleccionado de la biblioteca combinada de tus cuentas Steam.";

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, games.length - 1)));
  }, [games.length]);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
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
    if (!selectedGame) return;
    let cancelled = false;
    setLoadingDetails(true);
    loadDetails(selectedGame.id)
      .then((value) => { if (!cancelled) setDetails(value); })
      .catch(() => { if (!cancelled) setDetails(null); })
      .finally(() => { if (!cancelled) setLoadingDetails(false); });
    return () => { cancelled = true; };
  }, [selectedGame?.id]);

  useEffect(() => {
    if (!selectedGame) return;
    if (installed) setActionIndex(0);
    else if (selectedGame.app_id) setActionIndex(1);
    else setActionIndex(2);
  }, [selectedGame?.id, installed]);

  const moveGrid = (delta: number) => {
    setSelectedIndex((current) => Math.max(0, Math.min(games.length - 1, current + delta)));
  };

  const enterActions = () => {
    setFocusZone("actions");
    window.requestAnimationFrame(() => actionRefs.current[actionIndex]?.focus({ preventScroll: true }));
  };

  const returnToGrid = () => {
    setFocusZone("grid");
    rootRef.current?.focus({ preventScroll: true });
  };

  const activateAction = () => {
    if (!selectedGame) return;
    if (actionIndex === 0 && installed && !busy && selectedGame.copies_available > 0) void onPlay(selectedGame);
    if (actionIndex === 1 && selectedGame.app_id && !installed && !activeDownload) void onDownload(selectedGame);
    if (actionIndex === 2) onOpenDetails(selectedGame);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!selectedGame || !games.length) return;
    const key = event.key.toLowerCase();
    if (focusZone === "actions") {
      if (key === "escape" || key === "s" || key === "arrowdown") { event.preventDefault(); returnToGrid(); return; }
      if (["a", "arrowleft", "w", "arrowup"].includes(key)) {
        event.preventDefault();
        const next = (actionIndex - 1 + 3) % 3;
        setActionIndex(next);
        actionRefs.current[next]?.focus({ preventScroll: true });
        return;
      }
      if (["d", "arrowright"].includes(key)) {
        event.preventDefault();
        const next = (actionIndex + 1) % 3;
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

  const actions = useMemo(() => [
    { label: installed ? "Jugar" : "No instalado", icon: busy ? <Loader2 className="spin" size={23} /> : <Play size={23} fill="currentColor" />, disabled: !installed || busy || selectedGame.copies_available <= 0 },
    { label: installed ? "Instalado" : activeDownload ? `${Math.round(download?.progress ?? 0)}%` : "Descargar", icon: activeDownload ? <Loader2 className="spin" size={23} /> : <Download size={23} />, disabled: !selectedGame.app_id || installed || activeDownload },
    { label: "Ficha completa", icon: <Info size={23} />, disabled: false },
  ], [activeDownload, busy, download?.progress, installed, selectedGame]);

  if (!selectedGame) return <section className="library-room library-room-empty">No hay juegos disponibles.</section>;

  return (
    <section ref={rootRef} className={`library-room focus-${focusZone}`} tabIndex={-1} onKeyDown={onKeyDown} aria-label="Biblioteca">
      <aside className="library-room-feature" style={hero ? { backgroundImage: `url("${hero}")` } : undefined}>
        {movie?.mp4 ? <video key={movie.mp4} className="library-room-video" src={movie.mp4} poster={movie.thumbnail} autoPlay muted loop playsInline /> : null}
        <div className="library-room-feature-shade" />
        <div className="library-room-feature-copy">
          <span className="eyebrow">TU BIBLIOTECA</span>
          <h1>{selectedGame.name}</h1>
          <p>{summary}</p>
          {loadingDetails ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando medios de Steam…</span> : null}
          <div className="library-room-actions" aria-label="Acciones del juego seleccionado">
            {actions.map((action, index) => (
              <button
                key={action.label}
                ref={(node) => { actionRefs.current[index] = node; }}
                className={`library-room-action ${focusZone === "actions" && actionIndex === index ? "is-selected" : ""}`}
                onFocus={() => { setFocusZone("actions"); setActionIndex(index); }}
                onClick={() => { setActionIndex(index); if (!action.disabled) { if (index === 0) void onPlay(selectedGame); else if (index === 1) void onDownload(selectedGame); else onOpenDetails(selectedGame); } }}
                disabled={action.disabled}
              >
                {action.icon}<strong>{action.label}</strong>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="library-room-catalog">
        <header className="library-room-heading"><div><span className="eyebrow">BIBLIOTECA</span><h2>Elegí un juego</h2></div><small>{games.length} juegos · WASD / FLECHAS</small></header>
        <div ref={gridRef} className="library-room-grid">
          {games.map((game, index) => (
            <button
              key={game.id}
              className={`library-room-card ${index === selectedIndex ? "is-selected" : ""}`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => { setSelectedIndex(index); setFocusZone("grid"); rootRef.current?.focus({ preventScroll: true }); }}
              aria-current={index === selectedIndex ? "true" : undefined}
              aria-label={`${index === selectedIndex ? "Seleccionado: " : "Seleccionar "}${game.name}`}
              tabIndex={-1}
            >
              <span className="library-room-card-art">{game.capsule_image || game.header_image ? <img src={game.capsule_image || game.header_image || ""} alt="" draggable={false} loading="lazy" /> : <Gamepad2 size={34} />}</span>
              <strong>{game.name}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="library-room-hint"><span>NAVEGAR · WASD / FLECHAS</span><span>ENTRAR / ACTIVAR · ENTER</span><span>VOLVER · ESC</span></div>
    </section>
  );
}
