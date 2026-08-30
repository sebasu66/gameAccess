import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  Gamepad2,
  Gauge,
  Info,
  Loader2,
  MonitorCheck,
  Pause,
  Play,
  Search,
  Settings,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";

import { leaseGame, loadDetails, loadHome } from "./api";
import SteamGlobalSearch from "./SteamGlobalSearch";
import LibraryRoom from "./LibraryRoom";
import {
  getMachineProfile,
  getVisualDebugConfig,
  captureVisualDebug,
  finishVisualDebug,
  openSteamInstall,
  openSteamRun,
  steamDownloadStatus,
  steamInstalled,
  switchSteamAccount,
  setVisualDebugViewport,
  type MachineProfile,
  type SteamDownloadStatus,
} from "./native";
import type { CatalogGame, GameDetails, SteamMetadata, UserSummary } from "./types";

const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
let visualDebugStarted = false;

type VisualCheck = { selector: string; label: string; minWidth?: number; minHeight?: number; mustFitWidth?: boolean };

function inspectVisualChecks(checks: VisualCheck[]) {
  return checks.map((check) => {
    const element = document.querySelector<HTMLElement>(check.selector);
    const rect = element?.getBoundingClientRect();
    const style = element ? window.getComputedStyle(element) : null;
    const visible = Boolean(element && rect && rect.width > 0 && rect.height > 0 && style?.visibility !== "hidden" && style?.display !== "none" && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth);
    const largeEnough = Boolean(rect && rect.width >= (check.minWidth ?? 1) && rect.height >= (check.minHeight ?? 1));
    const fitsWidth = !check.mustFitWidth || Boolean(element && element.scrollWidth <= element.clientWidth + 1);
    return { ...check, visible, largeEnough, fitsWidth, width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0), pass: visible && largeEnough && fitsWidth };
  });
}

type SessionPhase = "reserving" | "preparing" | "launching" | "playing" | "waiting-adapter" | "demo-ready" | "error";
type Preference = 1 | -1;
type DownloadMap = Record<number, SteamDownloadStatus>;

type SessionView = {
  game: CatalogGame;
  phase: SessionPhase;
  title: string;
  detail: string;
  log?: string[];
};

function availabilityLabel(game: CatalogGame) {
  if (game.copies_available > 0) return `${game.copies_available} disponible${game.copies_available === 1 ? "" : "s"}`;
  if (game.copies_total > 0) return "Ocupado";
  return "Sin stock";
}

function minRamGb(steam?: SteamMetadata | null): number | null {
  const text = stripHtml(steam?.minimum_requirements);
  const matches = [...text.matchAll(/(?:memory|memoria)\s*:?\s*(\d+(?:\.\d+)?)\s*gb/gi)];
  if (!matches.length) return null;
  return Math.max(...matches.map((match) => Number(match[1])).filter(Number.isFinite));
}

function heavinessLabel(steam?: SteamMetadata | null, machine?: MachineProfile | null) {
  if (!steam) return null;
  const requiredRam = minRamGb(steam);
  if (requiredRam && machine?.memory_gb && requiredRam > machine.memory_gb + 0.25) {
    return { tone: "bad", text: `Muy pesado · pide ${requiredRam} GB RAM` };
  }

  const req = stripHtml(steam.minimum_requirements).toLowerCase();
  const demandingGpu = /(rtx\s*(20|30|40|50)|rx\s*(57|66|67|68|69|76|77|78|79)|gtx\s*1080)/i.test(req);
  if ((requiredRam && requiredRam >= 16) || demandingGpu) {
    return { tone: "warn", text: "Requisitos altos" };
  }
  if (machine && requiredRam) return { tone: "good", text: "Tu RAM cumple el mínimo" };
  return null;
}

function releaseScore(details?: GameDetails) {
  const date = details?.steam?.release_date;
  if (!date) return 0;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function GlassActionButton({
  icon,
  label,
  tone = "neutral",
  pulse = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "neutral" | "play" | "download";
  pulse?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`glass-action ${tone} ${pulse ? "pulse" : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      <span className="glass-action-icon">{icon}</span>
      <span className="glass-action-label">{label}</span>
    </button>
  );
}

function GameCard({
  game,
  details,
  machine,
  download,
  preference,
  showPreference = false,
  onOpen,
  onPreference,
}: {
  game: CatalogGame;
  details?: GameDetails;
  machine?: MachineProfile | null;
  download?: SteamDownloadStatus;
  preference?: Preference;
  showPreference?: boolean;
  onOpen: (game: CatalogGame) => void;
  onPreference: (gameId: number, value: Preference) => void;
}) {
  const activeDownload = download && ["requested", "preparing", "downloading"].includes(download.state);
  const progress = Math.max(0, Math.min(100, download?.progress ?? (download?.state === "requested" ? 4 : 0)));
  const weight = heavinessLabel(details?.steam, machine);

  return (
    <article className={`game-card ${activeDownload ? "is-downloading" : ""}`} style={{ "--download-progress": `${progress}%` } as React.CSSProperties}>
      <button className="game-card-main" onClick={() => onOpen(game)} aria-label={`Abrir ${game.name}`}>
        <div className="game-card-art">
          {game.capsule_image ? (
            <>
              <img className="card-art-base" src={game.capsule_image} alt="" loading="lazy" />
              {activeDownload ? <img className="card-art-color-fill" src={game.capsule_image} alt="" aria-hidden="true" /> : null}
            </>
          ) : (
            <div className="game-card-fallback"><Gamepad2 size={42} /></div>
          )}
          <div className="game-card-gradient" />
          <span className={`availability-chip ${game.copies_available > 0 ? "ready" : "wait"}`}>
            <span className="dot" /> {availabilityLabel(game)}
          </span>
          {weight ? <span className={`hardware-chip ${weight.tone}`}><Gauge size={12} /> {weight.text}</span> : null}
          {activeDownload ? (
            <div className="download-card-status">
              <Download size={15} />
              <strong>{download?.progress != null ? `${Math.round(download.progress)}%` : "Preparando…"}</strong>
            </div>
          ) : null}
          {download?.state === "installed" ? <span className="installed-chip"><Check size={12} /> Listo</span> : null}
          <div className="game-card-hover">
            <span className="round-play"><Play size={18} fill="currentColor" /></span>
            <span className="card-price">{game.credit_cost_per_hour} fichas/h</span>
          </div>
        </div>
        <div className="game-card-copy">
          <strong>{game.name}</strong>
          {download?.state === "installed" ? <span>Instalado · listo para jugar</span> : null}
        </div>
      </button>
      {showPreference ? (
        <div className="preference-controls" aria-label={`Preferencia para ${game.name}`}>
          <button className={preference === 1 ? "selected" : ""} onClick={() => onPreference(game.id, 1)} aria-label="Me gusta"><ThumbsUp size={16} /></button>
          <button className={preference === -1 ? "selected negative" : ""} onClick={() => onPreference(game.id, -1)} aria-label="No me gusta"><ThumbsDown size={16} /></button>
        </div>
      ) : null}
    </article>
  );
}

function Shelf({
  title,
  subtitle,
  games,
  detailsById,
  machine,
  downloads,
  preferences,
  showPreference = false,
  onOpen,
  onPreference,
  onViewAll,
}: {
  title: string;
  subtitle?: string;
  games: CatalogGame[];
  detailsById: Partial<Record<number, GameDetails>>;
  machine: MachineProfile | null;
  downloads: DownloadMap;
  preferences: Record<number, Preference>;
  showPreference?: boolean;
  onOpen: (game: CatalogGame) => void;
  onPreference: (gameId: number, value: Preference) => void;
  onViewAll?: () => void;
}) {
  if (!games.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-heading">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {onViewAll ? <button className="text-action" onClick={onViewAll}>Ver más <ChevronRight size={16} /></button> : null}
      </div>
      <div className="cards-row">
        {games.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            details={detailsById[game.id]}
            machine={machine}
            download={game.app_id ? downloads[game.app_id] : undefined}
            preference={preferences[game.id]}
            showPreference={showPreference}
            onOpen={onOpen}
            onPreference={onPreference}
          />
        ))}
      </div>
    </section>
  );
}

function LibrarySphere({ games, query, setQuery, onOpen, onClose, detailOpen = false }: {
  games: CatalogGame[];
  query: string;
  setQuery: (value: string) => void;
  onOpen: (game: CatalogGame) => void;
  onClose: () => void;
  detailOpen?: boolean;
}) {
  const visible = games.filter((game) => game.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const columns = 11;
  const selectedGame = visible[selectedIndex] ?? visible[0];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      const radius = Math.max(900, Math.min(1800, entry.contentRect.width * .72));
      root.style.setProperty("--dome-radius", `${Math.round(radius)}px`);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, visible.length - 1)));
  }, [query, visible.length]);

  useEffect(() => {
    if (!detailOpen) rootRef.current?.focus({ preventScroll: true });
  }, [detailOpen]);

  const moveSelection = (delta: number) => {
    setSelectedIndex((current) => Math.max(0, Math.min(visible.length - 1, current + delta)));
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (detailOpen) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key === "f") {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (event.target instanceof HTMLInputElement && key !== "escape") return;
    if (key === "arrowleft" || key === "a") moveSelection(-1);
    else if (key === "arrowright" || key === "d") moveSelection(1);
    else if (key === "arrowup" || key === "w") moveSelection(-columns);
    else if (key === "arrowdown" || key === "s") moveSelection(columns);
    else if (key === "enter" && selectedGame) onOpen(selectedGame);
    else if (key === "escape") onClose();
    else return;
    event.preventDefault();
  };

  return (
    <div ref={rootRef} className={`library-vault dome-root ${detailOpen ? "has-detail" : ""}`} role="dialog" aria-modal="true" aria-label="Tu biblioteca completa" tabIndex={-1} onKeyDown={keyDown}>
      <div className="library-vault-head">
        <div><span className="eyebrow">BIBLIOTECA INMERSIVA</span><h2>{selectedGame?.name ?? "Tus juegos"}</h2><p>{visible.length} juegos en esta vista</p></div>
        <div className="library-vault-actions">
          <label className="library-search"><Search size={18} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en tu biblioteca" />{query ? <button onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={16} /></button> : null}</label>
          <button className="library-close" onClick={onClose} aria-label="Cerrar biblioteca"><X size={20} /></button>
        </div>
      </div>
      <div className="dome-viewport">
        <div className="dome-stage"><div className="dome-sphere">
          {visible.map((game, index) => {
            const selectedRow = Math.floor(selectedIndex / columns);
            const selectedColumn = selectedIndex % columns;
            const row = Math.floor(index / columns);
            const column = index % columns;
            const offsetX = column - selectedColumn;
            const offsetY = row - selectedRow;
            const selected = index === selectedIndex;
            return <button className={`dome-cell ${selected ? "is-selected" : ""}`} key={game.id} style={{ "--dome-x": offsetX, "--dome-y": offsetY } as React.CSSProperties} onClick={() => setSelectedIndex(index)} onDoubleClick={() => onOpen(game)} aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}`} aria-current={selected ? "true" : undefined}>
              {game.capsule_image || game.header_image ? <img src={game.capsule_image ?? game.header_image ?? ""} alt="" draggable={false} /> : <span className="dome-cell-fallback"><Gamepad2 size={32} /></span>}<span>{game.name}</span>
            </button>;
          })}
        </div></div>
        <div className="dome-vignette" />
        {!visible.length ? <div className="library-empty">No encontramos juegos con “{query}”.</div> : null}
      </div>
      {selectedGame ? <div className="dome-selection-readout"><span>{selectedIndex + 1} / {visible.length}</span><strong>{selectedGame.name}</strong><small>ENTER · ABRIR FICHA</small></div> : null}
      <div className="dome-controls-hint" aria-label="Controles de navegación">{detailOpen ? <><span>NAVEGAR ACCIONES · WASD / FLECHAS</span><span>ACTIVAR · ENTER</span><span>VOLVER · ESC</span></> : <><span>NAVEGAR · WASD / FLECHAS</span><span>VER DETALLES · ENTER</span><span>BUSCAR · CTRL+F</span><span>VOLVER · ESC</span></>}</div>
    </div>
  );
}

function SessionOverlay({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const active = ["reserving", "preparing", "launching"].includes(session.phase);
  const success = ["playing", "demo-ready"].includes(session.phase);
  return (
    <div className="session-backdrop">
      <section className="session-card" style={session.game.hero_image ? { backgroundImage: `url("${session.game.hero_image}")` } : undefined}>
        <div className="session-shade" />
        <div className="session-content">
          <div className={`session-status-icon ${success ? "success" : session.phase === "error" ? "error" : ""}`}>
            {active ? <Loader2 className="spin" size={28} /> : success ? <Check size={28} /> : <Gamepad2 size={28} />}
          </div>
          <span className="eyebrow">PREPARANDO TU PARTIDA</span>
          <h2>{session.game.name}</h2>
          <h3>{session.title}</h3>
          <p>{session.detail}</p>
          {session.log?.length ? <div className="session-log">{session.log.map((line, index) => <div key={`${index}-${line}`}><span>{String(index + 1).padStart(2, "0")}</span>{line}</div>)}</div> : null}
          <div className="session-steps" aria-label="Progreso de inicio">
            <span className={session.phase !== "reserving" ? "done" : "current"}>Reserva</span><i />
            <span className={["launching", "playing", "demo-ready", "waiting-adapter"].includes(session.phase) ? "done" : session.phase === "preparing" ? "current" : ""}>Preparación</span><i />
            <span className={success ? "done" : session.phase === "launching" ? "current" : ""}>Juego</span>
          </div>
          {!active ? <button className="secondary-button session-close" onClick={onClose}>{success ? "Listo" : "Volver al catálogo"}</button> : null}
        </div>
      </section>
    </div>
  );
}

function DetailPanel({
  game,
  machine,
  download,
  onClose,
  onLease,
  onDownload,
  busy,
  overLibrary = false,
}: {
  game: CatalogGame;
  machine: MachineProfile | null;
  download?: SteamDownloadStatus;
  onClose: () => void;
  onLease: (game: CatalogGame) => Promise<void>;
  onDownload: (game: CatalogGame) => Promise<void>;
  busy: boolean;
  overLibrary?: boolean;
}) {
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeShot, setActiveShot] = useState(0);
  const [closing, setClosing] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const closeWithAnimation = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 220);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (optionsOpen) setOptionsOpen(false); else closeWithAnimation();
        return;
      }
      const actions = optionsOpen ? [] : [
        ...Array.from(document.querySelectorAll<HTMLButtonElement>(".detail-primary-actions button:not(:disabled)")),
        ...Array.from(document.querySelectorAll<HTMLButtonElement>(".detail-corner-actions button:not(:disabled)")),
      ];
      if (!optionsOpen && event.key === "Enter" && !(document.activeElement instanceof HTMLButtonElement)) {
        event.preventDefault();
        actions[0]?.click();
        return;
      }
      if (!optionsOpen && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "d", "w", "s"].includes(event.key)) {
        if (!actions.length) return;
        event.preventDefault();
        const current = Math.max(0, actions.indexOf(document.activeElement as HTMLButtonElement));
        const backwards = ["ArrowLeft", "ArrowUp", "a", "w"].includes(event.key);
        actions[(current + (backwards ? -1 : 1) + actions.length) % actions.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closing, optionsOpen]);

  useEffect(() => {
    if (!optionsOpen) window.setTimeout(() => document.querySelector<HTMLButtonElement>(".detail-primary-actions button:not(:disabled)")?.focus(), 40);
  }, [optionsOpen, game.id, download?.state]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    setError(null);
    setActiveShot(0);
    loadDetails(game.id)
      .then((value) => !cancelled && setDetails(value))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [game.id]);

  const steam = details?.steam;
  const description = stripHtml(steam?.short_description || steam?.about_the_game) || "Elegí el juego, preparalo y gameAccess gestiona el acceso cuando tocás Jugar.";
  const hero = steam?.background || steam?.hero_image || game.hero_image || game.header_image || game.capsule_image || undefined;
  const trailer = steam?.movies?.find((movie) => movie.highlight) || steam?.movies?.[0];
  const weight = heavinessLabel(steam, machine);
  const activeDownload = download && ["requested", "preparing", "downloading"].includes(download.state);
  const installed = download?.state === "installed";
  const currentShot = steam?.screenshots?.[activeShot];

  return (
    <div className={`modal-backdrop ${closing ? "is-closing" : ""} ${overLibrary ? "over-library" : ""}`} onMouseDown={closeWithAnimation}>
      <article className="detail-panel detail-panel-rich" onMouseDown={(event) => event.stopPropagation()}>
        <div className="detail-corner-actions detail-keyboard-actions">
          <button className="detail-gear" onClick={() => setOptionsOpen(true)} aria-label="Opciones del juego"><Settings size={20} /></button>
          <button className="close-detail" onClick={closeWithAnimation} aria-label="Volver"><X size={22} /></button>
        </div>
        <div className="detail-hero" style={hero ? { backgroundImage: `url("${hero}")` } : undefined}>
          {trailer?.mp4 ? (
            <video className="detail-hero-video" src={trailer.mp4} poster={trailer.thumbnail} autoPlay muted loop playsInline />
          ) : null}
          <div className="detail-hero-shade" />
          <div className="detail-hero-copy">
            <span className="eyebrow">FICHA DEL JUEGO</span>
            <h1>{steam?.name || game.name}</h1>
            <div className="detail-meta">
              <span className={game.copies_available > 0 ? "meta-ready" : "meta-wait"}>{availabilityLabel(game)}</span>
              {steam?.release_date ? <span>{steam.release_date}</span> : null}
              {steam?.metacritic?.score ? <span className="score"><Star size={13} fill="currentColor" /> {steam.metacritic.score}</span> : null}
              {weight ? <span className={`compatibility-pill ${weight.tone}`}><Gauge size={13} /> {weight.text}</span> : null}
            </div>
            <p>{description}</p>
            <div className="detail-actions detail-primary-actions detail-keyboard-actions glass-actions-row">
              <GlassActionButton
                icon={busy ? <Loader2 size={23} className="spin" /> : <Play size={24} fill="currentColor" />}
                label={game.copies_available > 0 ? "Jugar ahora" : "Sin copia"}
                tone="play" pulse={game.copies_available > 0}
                disabled={!installed || busy || game.copies_available <= 0}
                onClick={() => void onLease(game)}
              />
              <GlassActionButton
                icon={activeDownload ? <Loader2 size={23} className="spin" /> : <Download size={24} />}
                label={installed ? "Instalado" : activeDownload ? (download?.progress != null ? `${Math.round(download.progress)}%` : "Preparando") : "Descargar"}
                tone="download" disabled={!game.app_id || installed || Boolean(activeDownload)}
                onClick={() => void onDownload(game)}
              />
            </div>
          </div>
          <div className="hero-price detail-price"><span>Desde</span><strong>{game.credit_cost_per_hour}</strong><small>fichas / hora</small></div>
        </div>

        <div className="detail-body detail-body-rich">
          {loading ? <div className="loading-line"><Loader2 size={18} className="spin" /> Obteniendo ficha completa desde Steam…</div> : null}
          {error ? <div className="detail-warning">No pudimos cargar la ficha extendida ahora. La biblioteca sigue disponible.</div> : null}

          {trailer?.mp4 ? (
            <section className="media-block">
              <div className="section-title"><h3>Tráiler</h3><span>{trailer.name || "Video oficial"}</span></div>
              <video className="detail-trailer" controls playsInline poster={trailer.thumbnail}>
                <source src={trailer.mp4} type="video/mp4" />
                {trailer.webm ? <source src={trailer.webm} type="video/webm" /> : null}
              </video>
            </section>
          ) : null}

          {steam?.screenshots?.length ? (
            <section className="screenshots-block gallery-block">
              <div className="section-title"><h3>Fotos</h3><span>{steam.screenshots.length} capturas oficiales</span></div>
              {currentShot ? <img className="gallery-main" src={currentShot.full || currentShot.thumbnail} alt={`${game.name} captura ${activeShot + 1}`} /> : null}
              <div className="screenshots-row gallery-thumbs">
                {steam.screenshots.slice(0, 12).map((shot, index) => (
                  <button key={`${shot.id ?? index}`} className={index === activeShot ? "active" : ""} onClick={() => setActiveShot(index)}>
                    <img src={shot.thumbnail || shot.full} alt={`Ver captura ${index + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="detail-grid detail-grid-rich">
            <section className="about-card">
              <h3>Acerca del juego</h3>
              <p>{stripHtml(steam?.about_the_game) || description}</p>
              {steam?.detailed_description ? <p className="secondary-copy">{stripHtml(steam.detailed_description)}</p> : null}
            </section>
            <aside className="facts-card">
              {steam?.genres?.length ? <div className="fact"><span>Géneros</span><strong>{steam.genres.slice(0, 6).join(" · ")}</strong></div> : null}
              {steam?.categories?.length ? <div className="fact"><span>Características</span><strong>{steam.categories.slice(0, 6).join(" · ")}</strong></div> : null}
              {steam?.developers?.length ? <div className="fact"><span>Desarrollador</span><strong>{steam.developers.join(", ")}</strong></div> : null}
              {steam?.publishers?.length ? <div className="fact"><span>Publisher</span><strong>{steam.publishers.join(", ")}</strong></div> : null}
              {steam?.recommendation_count ? <div className="fact"><span>Recomendaciones</span><strong>{steam.recommendation_count.toLocaleString("es-AR")}</strong></div> : null}
              {steam?.achievement_count ? <div className="fact"><span>Logros</span><strong><Trophy size={14} /> {steam.achievement_count}</strong></div> : null}
              {steam?.price?.final_formatted ? <div className="fact"><span>Precio Steam de referencia</span><strong>{steam.price.final_formatted}</strong></div> : null}
              {steam?.supported_languages ? <div className="fact"><span>Idiomas</span><strong>{stripHtml(steam.supported_languages).slice(0, 220)}</strong></div> : null}
            </aside>
          </div>

          {(steam?.minimum_requirements || steam?.recommended_requirements) ? (
            <section className="requirements-block">
              <div className="section-title"><h3>Requisitos de PC</h3>{machine ? <span><MonitorCheck size={14} /> {machine.memory_gb ? `${machine.memory_gb.toFixed(0)} GB RAM detectados` : "PC detectada"}</span> : null}</div>
              <div className="requirements-grid">
                <div><span>Mínimos</span><p>{stripHtml(steam.minimum_requirements) || "No publicados"}</p></div>
                <div><span>Recomendados</span><p>{stripHtml(steam.recommended_requirements) || "No publicados"}</p></div>
              </div>
              {machine?.cpu ? <div className="machine-line"><strong>Tu CPU:</strong> {machine.cpu}</div> : null}
              {machine?.gpus?.length ? <div className="machine-line"><strong>Tu GPU:</strong> {machine.gpus.join(" · ")}</div> : null}
            </section>
          ) : null}
        </div>
        {optionsOpen ? <div className="game-options-backdrop" onMouseDown={() => setOptionsOpen(false)}><section className="game-options-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Opciones del juego"><span className="eyebrow">ADMINISTRAR JUEGO</span><h2>{game.name}</h2><p>Opciones de instalación y mantenimiento.</p><button className="secondary-button" disabled>Desinstalar · próximamente</button><button className="secondary-button" onClick={() => setOptionsOpen(false)}>Volver</button></section></div> : null}
      </article>
    </div>
  );
}

export default function App() {
  const [games, setGames] = useState<CatalogGame[]>([]);
  const [user, setUser] = useState<UserSummary>({ id: 1, username: "demo", credits: 0 });
  const [offlineDemo, setOfflineDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CatalogGame | null>(null);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [steamOk, setSteamOk] = useState(true);
  const [session, setSession] = useState<SessionView | null>(null);
  const [detailsById, setDetailsById] = useState<Partial<Record<number, GameDetails>>>({});
  const [machine, setMachine] = useState<MachineProfile | null>(null);
  const [downloads, setDownloads] = useState<DownloadMap>({});
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [heroMuted, setHeroMuted] = useState(true);
  const [magazineFocus, setMagazineFocus] = useState(0);
  const [magazineShape, setMagazineShape] = useState({ columns: 3, rows: 2 });
  const magazineCatalogRef = useRef<HTMLElement | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [preferences, setPreferences] = useState<Record<number, Preference>>(() => {
    try { return JSON.parse(localStorage.getItem("gameaccess:preferences") || "{}"); } catch { return {}; }
  });
  const [recentIds, setRecentIds] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem("gameaccess:recent") || "[]"); } catch { return []; }
  });
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    const home = await loadHome();
    setGames(home.games);
    setUser(home.user);
    setOfflineDemo(home.offlineDemo);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    steamInstalled().then(setSteamOk).catch(() => setSteamOk(true));
    getMachineProfile().then(setMachine).catch(() => setMachine(null));
  }, []);

  useEffect(() => {
    if (loading || !games.length || visualDebugStarted) return;
    visualDebugStarted = true;
    const firstGame = orderedLibrary[0] ?? games[0];
    const results: Array<Record<string, unknown>> = [];
    const profiles = ["medium", "maximized"] as const;

    const captureStep = async (profile: typeof profiles[number], name: string, checks: VisualCheck[]) => {
      await wait(900);
      const checked = inspectVisualChecks(checks);
      const viewportFits = document.documentElement.scrollWidth <= window.innerWidth + 1;
      try {
        const screenshot = await captureVisualDebug(`${profile}-${name}`);
        results.push({ profile, screen: name, screenshot, viewportFits, checks: checked, pass: viewportFits && checked.every((item) => item.pass) });
      } catch (error) {
        results.push({ profile, screen: name, checks: checked, pass: false, error: error instanceof Error ? error.message : String(error) });
      }
    };

    const run = async () => {
      const config = await getVisualDebugConfig();
      if (!config.enabled) {
        visualDebugStarted = false;
        return;
      }
      for (const profile of profiles) {
        await setVisualDebugViewport(profile);
        await wait(700);

        setSelected(null); setLibraryOpen(false); setSession(null);
        await captureStep(profile, "home", [
          { selector: ".brand", label: "Brand", minWidth: 120, minHeight: 32 },
          { selector: ".topbar-actions .global-search", label: "Global search", minWidth: 180, minHeight: 36 },
          { selector: ".hero", label: "Featured game", minWidth: 600, minHeight: 260 },
          { selector: ".game-card", label: "Library game card", minWidth: 100, minHeight: 160 },
        ]);

        setQuery(firstGame.name);
        await captureStep(profile, "global-search", [
          { selector: ".global-search-page h1", label: "Search results heading", minWidth: 220, minHeight: 30 },
          { selector: ".global-search-back", label: "Back to home action", minWidth: 120, minHeight: 32 },
          { selector: ".global-search-result-card", label: "Search result", minWidth: 320, minHeight: 72 },
        ]);
        setQuery("");

        setLibraryOpen(true);
        await captureStep(profile, "library", [
          { selector: ".library-vault-head h2", label: "Library heading", minWidth: 180, minHeight: 30 },
          { selector: ".library-search", label: "Library search", minWidth: 220, minHeight: 40 },
          { selector: ".library-close", label: "Library close", minWidth: 40, minHeight: 40 },
          { selector: ".dome-cell", label: "3D library tile", minWidth: 80, minHeight: 100 },
        ]);

        await captureStep(profile, "library-selection", [
          { selector: ".dome-cell.is-selected", label: "Centered selected game", minWidth: 100, minHeight: 150 },
          { selector: ".dome-selection-readout", label: "Selection controls", minWidth: 220, minHeight: 16 },
          { selector: ".dome-controls-hint", label: "Keyboard navigation hint", minWidth: 130, minHeight: 50 },
        ]);

        setSelected(firstGame);
        await captureStep(profile, "game-detail", [
          { selector: ".detail-panel", label: "Game details", minWidth: 600, minHeight: 500, mustFitWidth: true },
          { selector: ".close-detail", label: "Details close", minWidth: 36, minHeight: 36 },
          { selector: ".detail-gear", label: "Game options", minWidth: 36, minHeight: 36 },
          { selector: ".detail-hero h1", label: "Game title", minWidth: 120, minHeight: 30 },
        ]);

        setSelected(null); setLibraryOpen(false);
        setSession({ game: firstGame, phase: "demo-ready", title: "Visual debug session", detail: "Synthetic state used only to validate the session dialog." });
        await captureStep(profile, "session-dialog", [
          { selector: ".session-card", label: "Session dialog", minWidth: 360, minHeight: 260 },
          { selector: ".session-card button", label: "Session dialog action", minWidth: 32, minHeight: 32 },
        ]);
      }
      setSession(null); setSelected(null); setLibraryOpen(false);
      const manifest = await finishVisualDebug({ session_dir: config.session_dir, created_at: new Date().toISOString(), results });
      setToast(`Visual debug completo: ${manifest}`);
    };
    void run().catch((error) => setToast(`Visual debug falló: ${error instanceof Error ? error.message : String(error)}`));
  }, [loading, games.length]);

  useEffect(() => {
    if (!games.length) return;
    let cancelled = false;
    const preload = async () => {
      const next: Partial<Record<number, GameDetails>> = {};
      await Promise.all(games.slice(0, 16).map(async (game) => {
        try { next[game.id] = await loadDetails(game.id); } catch { /* metadata remains lazy */ }
      }));
      if (!cancelled) setDetailsById((current) => ({ ...current, ...next }));
    };
    void preload();
    return () => { cancelled = true; };
  }, [games]);

  useEffect(() => {
    if (!games.length) return;
    let cancelled = false;
    const probe = async () => {
      const next: DownloadMap = {};
      await Promise.all(games.map(async (game) => {
        if (!game.app_id) return;
        try { next[game.app_id] = await steamDownloadStatus(game.app_id); } catch { /* browser preview */ }
      }));
      if (!cancelled) setDownloads((current) => ({ ...current, ...next }));
    };
    void probe();
    return () => { cancelled = true; };
  }, [games]);

  useEffect(() => {
    const activeIds = Object.entries(downloads)
      .filter(([, status]) => ["requested", "preparing", "downloading"].includes(status.state))
      .map(([id]) => Number(id));
    if (!activeIds.length) return;
    const timer = window.setInterval(() => {
      void Promise.all(activeIds.map(async (appId) => {
        try {
          const status = await steamDownloadStatus(appId);
          setDownloads((current) => ({ ...current, [appId]: status }));
        } catch { /* keep last known state */ }
      }));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [downloads]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    if (!needle) return games;
    return games.filter((game) => game.name.toLocaleLowerCase("es").includes(needle));
  }, [games, query]);

  const heroPool = useMemo(() => {
    const base = filtered.length ? filtered : games;
    return [...base].sort((a, b) => {
      const ra = detailsById[a.id]?.steam?.recommendation_count ?? 0;
      const rb = detailsById[b.id]?.steam?.recommendation_count ?? 0;
      return rb - ra || b.copies_available - a.copies_available;
    }).slice(0, 6);
  }, [filtered, games, detailsById]);

  useEffect(() => {
    if (heroIndex >= heroPool.length) setHeroIndex(0);
  }, [heroIndex, heroPool.length]);

  useEffect(() => {
    if (heroPaused || heroPool.length < 2) return;
    const timer = window.setInterval(() => setHeroIndex((current) => (current + 1) % heroPool.length), 18000);
    return () => window.clearInterval(timer);
  }, [heroPaused, heroPool.length]);

  const continueGames = useMemo(() => {
    const recent = recentIds.map((id) => filtered.find((game) => game.id === id)).filter((game): game is CatalogGame => Boolean(game));
    return recent.length ? recent.slice(0, 8) : filtered.filter((game) => game.copies_available > 0).slice(0, 4);
  }, [recentIds, filtered]);

  const orderedLibrary = useMemo(() => {
    const order = new Map(recentIds.map((id, index) => [id, index]));
    return [...games].sort((left, right) => {
      const leftRecent = order.get(left.id);
      const rightRecent = order.get(right.id);
      if (leftRecent !== undefined || rightRecent !== undefined) return (leftRecent ?? Number.MAX_SAFE_INTEGER) - (rightRecent ?? Number.MAX_SAFE_INTEGER);
      return left.name.localeCompare(right.name, "es");
    });
  }, [games, recentIds]);

  const magazineGames = orderedLibrary;
  useEffect(() => {
    const catalog = magazineCatalogRef.current;
    if (!catalog) return;
    const measure = () => {
      const width = catalog.clientWidth;
      const height = catalog.clientHeight - 86;
      const gap = Math.max(12, Math.min(20, width * .0135));
      const minimumCellWidth = 140;
      const columns = Math.max(1, Math.floor((width + gap) / (minimumCellWidth + gap)));
      const cellWidth = (width - gap * (columns - 1)) / columns;
      const cellHeight = cellWidth * 16 / 10;
      const rows = Math.max(1, Math.ceil(magazineGames.length / columns));
      setMagazineShape({ columns, rows });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(catalog);
    return () => observer.disconnect();
  }, [magazineGames.length]);
  const featured = magazineGames[magazineFocus] || heroPool[heroIndex] || filtered[0] || games[0];
  const heroDetails = featured ? detailsById[featured.id] : undefined;
  const heroMovie = heroDetails?.steam?.movies?.find((movie) => movie.highlight) || heroDetails?.steam?.movies?.[0];

  const newGames = useMemo(() => [...filtered].sort((a, b) => releaseScore(detailsById[b.id]) - releaseScore(detailsById[a.id])).slice(0, 10), [filtered, detailsById]);
  const suggestedGames = useMemo(() => [...filtered].sort((a, b) => (preferences[b.id] ?? 0) - (preferences[a.id] ?? 0) || (detailsById[b.id]?.steam?.recommendation_count ?? 0) - (detailsById[a.id]?.steam?.recommendation_count ?? 0)).slice(0, 12), [filtered, detailsById, preferences]);

  const openGame = (game: CatalogGame) => setSelected(game);

  const rememberRecent = (game: CatalogGame) => {
    const next = [game.id, ...recentIds.filter((id) => id !== game.id)].slice(0, 10);
    setRecentIds(next);
    localStorage.setItem("gameaccess:recent", JSON.stringify(next));
  };

  const setPreference = (gameId: number, value: Preference) => {
    const next = { ...preferences, [gameId]: preferences[gameId] === value ? undefined : value } as Record<number, Preference>;
    if (next[gameId] === undefined) delete next[gameId];
    setPreferences(next);
    localStorage.setItem("gameaccess:preferences", JSON.stringify(next));
    setToast(value === 1 ? "Lo tendremos en cuenta para recomendarte juegos." : "Perfecto, veremos menos juegos de este estilo.");
  };

  const startDownload = async (game: CatalogGame) => {
    if (!game.app_id) return;
    try {
      await openSteamInstall(game.app_id);
      setDownloads((current) => ({ ...current, [game.app_id!]: { app_id: game.app_id!, state: "requested", progress: null, bytes_downloaded: null, bytes_total: null, installed: false } }));
      rememberRecent(game);
      setToast("Steam recibió la descarga. gameAccess va a seguir su progreso cuando Steam cree la instalación.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    }
  };

  const doLease = async (game: CatalogGame) => {
    setSelected(null);
    rememberRecent(game);
    setLeaseBusy(true);
    setSession({ game, phase: "reserving", title: "Buscando una copia disponible", detail: "Estamos reservando acceso y validando tu saldo." });

    if ((game.local_access_labels?.length || game.local_account_labels?.length) && game.app_id) {
      const trace = [`Requested AppID = ${game.app_id}`, `Searching verified license-owner mapping for AppID ${game.app_id}`];
      try {
        setSession({ game, phase: "preparing", title: "Resolviendo propietario de la licencia", detail: "gameAccess está buscando la cuenta que realmente posee esta licencia.", log: trace });
        const localAccount = game.local_primary_account_label ?? game.local_account_labels?.[0];
        if (!localAccount) throw new Error(`No verified original owner was found for AppID ${game.app_id}. Accessible/Family-visible accounts are not accepted as owners.`);
        trace.push(`Owner map loaded at startup = ${game.local_account_labels?.join(", ") || localAccount}`);
        trace.push(`Original owner selected = ${localAccount}`);
        trace.push(`Selecting remembered Steam account = ${localAccount}`);
        setSession({ game, phase: "preparing", title: "Iniciando la cuenta propietaria", detail: "La licencia fue resuelta. Steam iniciará la cuenta propietaria exacta.", log: [...trace] });
        await switchSteamAccount(localAccount);
        trace.push(`ActiveUser confirmed for account = ${localAccount}`);
        trace.push(`Opening steam://run/${game.app_id}`);
        setSession({ game, phase: "launching", title: "Abriendo el juego", detail: "Steam confirmó la cuenta propietaria. Ahora gameAccess abre el juego automáticamente.", log: [...trace] });
        await openSteamRun(game.app_id);
        trace.push("Launch command accepted");
        setSession({ game, phase: "playing", title: "¡A jugar!", detail: "El juego se inició usando la cuenta propietaria verificada.", log: [...trace] });
      } catch (err) {
        trace.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        setSession({ game, phase: "error", title: "No pudimos iniciar la sesión local", detail: err instanceof Error ? err.message : String(err), log: [...trace] });
      } finally {
        setLeaseBusy(false);
      }
      return;
    }

    if (offlineDemo) {
      await wait(650);
      setSession({ game, phase: "preparing", title: "Preparando el acceso", detail: "gameAccess está dejando listo el entorno para iniciar el juego." });
      await wait(900);
      setSession({ game, phase: "demo-ready", title: "Flujo visual listo", detail: "Esta es la experiencia de preparación. Con el backend local conectado, acá continuaríamos con la sesión real." });
      setLeaseBusy(false);
      return;
    }

    try {
      const lease = await leaseGame(game.id, 60);
      setUser((current) => ({ ...current, credits: lease.credits_remaining }));
      setSession({ game, phase: "preparing", title: "Reserva confirmada", detail: "Ahora gameAccess prepara la sesión de juego asignada a esta reserva." });
      if (lease.session_action === "launch_ready" && lease.game.app_id) {
        await wait(450);
        setSession({ game, phase: "launching", title: "Abriendo el juego", detail: "Todo está listo. Estamos iniciando el juego en esta PC." });
        await openSteamRun(lease.game.app_id);
        await wait(450);
        setSession({ game, phase: "playing", title: "¡A jugar!", detail: "La sesión está activa. El tiempo reservado ya está asociado a tu partida." });
      } else {
        setSession({ game, phase: "waiting-adapter", title: "Reserva lista para el adaptador local", detail: "La reserva ya existe. Falta conectar a este cliente el paso local que prepara la sesión de Steam antes de lanzar el juego." });
      }
      await refresh();
    } catch (err) {
      setSession({ game, phase: "error", title: "No pudimos iniciar la sesión", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setLeaseBusy(false);
    }
  };

  const previousHero = () => setHeroIndex((current) => (current - 1 + heroPool.length) % heroPool.length);
  const nextHero = () => setHeroIndex((current) => (current + 1) % heroPool.length);
  const toggleHeroPlayback = () => {
    const video = heroVideoRef.current;
    if (video) {
      if (video.paused) void video.play(); else video.pause();
      setHeroPaused(!video.paused);
    } else {
      setHeroPaused((current) => !current);
    }
  };
  const toggleHeroVolume = () => {
    const next = !heroMuted;
    setHeroMuted(next);
    if (heroVideoRef.current) heroVideoRef.current.muted = next;
  };

  const moveMagazineFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const columns = magazineShape.columns;
    const moves: Record<string, number> = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1, ArrowUp: -columns, w: -columns, W: -columns, ArrowDown: columns, s: columns, S: columns };
    const movement = moves[event.key];
    if (!movement || !magazineGames.length) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(magazineGames.length - 1, magazineFocus + movement));
    setMagazineFocus(next);
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-magazine-index="${next}"] .game-card-main`)?.focus());
  };

  return (
    <div className="app-shell">
      <header className="topbar topbar-glass">
        <button className="brand" onClick={() => { setQuery(""); setSelected(null); }}><span className="brand-mark">g</span><span>game<span>Access</span></span></button>
        <nav className="glass-nav">
          <button className="glass-static-nav active"><span>Inicio</span></button>
          <button className="glass-static-nav"><span>Explorar</span></button>
          <button className="glass-static-nav"><span>Mi lista</span></button>
        </nav>
        <div className="topbar-actions">
          <SteamGlobalSearch query={query} setQuery={setQuery} onOpenCatalogGame={openGame} />
          <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
        </div>
      </header>

      {!steamOk ? <div className="system-banner">Steam no fue detectado en esta PC. Podés navegar el catálogo, pero descargar y jugar requerirá Steam.</div> : null}
      {offlineDemo ? <div className="system-banner demo"><Sparkles size={15} /> Modo offline: mostrando el catálogo combinado de las cuentas Steam detectadas en esta PC.</div> : null}

      <main>
        <LibraryRoom games={orderedLibrary} downloads={downloads} busy={leaseBusy} onPlay={doLease} onDownload={startDownload} onOpenDetails={openGame} />
        {featured ? (
          <section className="magazine-view" aria-label="Biblioteca en vista revista">
          <div className="hero hero-video magazine-feature" style={featured.hero_image ? { backgroundImage: `url("${featured.hero_image}")` } : undefined}>
            {heroMovie?.mp4 ? <video key={heroMovie.mp4} ref={heroVideoRef} className="hero-video-media" src={heroMovie.mp4} poster={heroMovie.thumbnail} autoPlay={!heroPaused} muted={heroMuted} playsInline loop /> : null}
            <div className="hero-shade" />
            <div className="hero-copy">
              <span className="hero-kicker">TU BIBLIOTECA</span>
              <h1>{featured.name}</h1>
              <p>Seleccionado de tus cuentas conectadas.</p>
              <div className="hero-actions glass-actions-row">
                <GlassActionButton icon={<Play size={24} fill="currentColor" />} label="Jugar ahora" tone="play" pulse disabled={featured.copies_available <= 0 || leaseBusy} onClick={() => void doLease(featured)} />
                <button className="secondary-button glass-info-button" onClick={() => setSelected(featured)}><Info size={19} /> Más información</button>
              </div>
            </div>
            <div className="hero-media-controls" aria-label="Controles del banner">
              <button onClick={previousHero} aria-label="Anterior"><ChevronLeft size={19} /></button>
              <button onClick={toggleHeroPlayback} aria-label={heroPaused ? "Reproducir" : "Pausar"}>{heroPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}</button>
              <button onClick={nextHero} aria-label="Siguiente"><ChevronRight size={19} /></button>
              <button onClick={toggleHeroVolume} aria-label={heroMuted ? "Activar sonido" : "Silenciar"}>{heroMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            </div>
          </div>
          <section ref={magazineCatalogRef} className="magazine-catalog" aria-label="Juegos recientes y favoritos">
            <div className="magazine-heading"><div><span className="eyebrow">RECIENTES Y FAVORITOS</span><h2>Elegí un juego</h2></div><button className="sphere-view-button" onClick={() => setLibraryOpen(true)} aria-label="Cambiar a vista esfera"><span /></button></div>
            <div className="magazine-grid" style={{ "--magazine-columns": magazineShape.columns, "--magazine-rows": magazineShape.rows } as React.CSSProperties} onKeyDown={moveMagazineFocus}>
              {magazineGames.map((game, index) => <div key={game.id} className={index === magazineFocus ? "magazine-item is-focused" : "magazine-item"} onFocus={() => setMagazineFocus(index)}><button className="magazine-card" data-magazine-index={index} onClick={() => openGame(game)} aria-label={`Abrir ${game.name}`}><span className="magazine-card-art">{game.capsule_image ? <img src={game.capsule_image} alt="" loading="lazy" /> : <Gamepad2 size={34} />}</span><span className="magazine-card-title">{game.name}</span></button></div>)}
            </div>
          </section>
          <div className="screen-controls-hint"><span>NAVEGAR · WASD / FLECHAS</span><span>DETALLES · ENTER</span><span>BUSCAR · CTRL+F</span></div>
          </section>
        ) : null}

        <div className="content-wrap magazine-secondary">
          {loading ? <div className="loading-home"><Loader2 className="spin" /> Cargando biblioteca…</div> : null}
          
          {offlineDemo ? (
            <Shelf title="Tu biblioteca" subtitle="Últimos jugados primero · catálogo combinado de tus cuentas locales" games={orderedLibrary.slice(0, 12)} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} onOpen={openGame} onPreference={setPreference} onViewAll={() => setLibraryOpen(true)} />
          ) : <>
            <Shelf title="Seguí donde estabas" subtitle="Tus juegos recientes y preparados" games={continueGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} onOpen={openGame} onPreference={setPreference} />
            <Shelf title="Nuevos lanzamientos" subtitle="Lo más nuevo del catálogo" games={newGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} onOpen={openGame} onPreference={setPreference} />
            <Shelf title="Te pueden gustar" subtitle="Vamos aprendiendo tus gustos con cada pulgar" games={suggestedGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} showPreference onOpen={openGame} onPreference={setPreference} />
          </>}
        </div>
      </main>

      {selected ? <DetailPanel game={selected} machine={machine} download={selected.app_id ? downloads[selected.app_id] : undefined} onClose={() => setSelected(null)} onLease={doLease} onDownload={startDownload} busy={leaseBusy} overLibrary={libraryOpen} /> : null}
      {libraryOpen ? <LibrarySphere games={orderedLibrary} query={libraryQuery} setQuery={setLibraryQuery} onOpen={openGame} onClose={() => setLibraryOpen(false)} detailOpen={Boolean(selected)} /> : null}
      {session ? <SessionOverlay session={session} onClose={() => setSession(null)} /> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
