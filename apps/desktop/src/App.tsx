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
import {
  getMachineProfile,
  openSteamInstall,
  openSteamRun,
  steamDownloadStatus,
  steamInstalled,
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

type SessionPhase = "reserving" | "preparing" | "launching" | "playing" | "waiting-adapter" | "demo-ready" | "error";
type Preference = 1 | -1;
type DownloadMap = Record<number, SteamDownloadStatus>;

type SessionView = {
  game: CatalogGame;
  phase: SessionPhase;
  title: string;
  detail: string;
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
          <span>{download?.state === "installed" ? "Instalado · listo para jugar" : "Abrir ficha"}</span>
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
}) {
  if (!games.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-heading">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button className="text-action">Ver todo <ChevronRight size={16} /></button>
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
}: {
  game: CatalogGame;
  machine: MachineProfile | null;
  download?: SteamDownloadStatus;
  onClose: () => void;
  onLease: (game: CatalogGame) => Promise<void>;
  onDownload: (game: CatalogGame) => Promise<void>;
  busy: boolean;
}) {
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeShot, setActiveShot] = useState(0);

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
  const currentShot = steam?.screenshots?.[activeShot];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <article className="detail-panel detail-panel-rich" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-detail" onClick={onClose} aria-label="Cerrar"><X size={22} /></button>
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
            <div className="detail-actions glass-actions-row">
              <GlassActionButton
                icon={busy ? <Loader2 size={23} className="spin" /> : <Play size={24} fill="currentColor" />}
                label={game.copies_available > 0 ? "Jugar ahora" : "Sin copia"}
                tone="play"
                pulse={game.copies_available > 0}
                disabled={busy || game.copies_available <= 0}
                onClick={() => void onLease(game)}
              />
              <GlassActionButton
                icon={activeDownload ? <Loader2 size={23} className="spin" /> : download?.state === "installed" ? <Check size={24} /> : <Download size={24} />}
                label={download?.state === "installed" ? "Instalado" : activeDownload ? (download.progress != null ? `${Math.round(download.progress)}%` : "Preparando") : "Descargar"}
                tone="download"
                disabled={!game.app_id || download?.state === "installed"}
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
      await Promise.all(games.slice(0, 20).map(async (game) => {
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

  const featured = heroPool[heroIndex] || filtered[0] || games[0];
  const heroDetails = featured ? detailsById[featured.id] : undefined;
  const heroMovie = heroDetails?.steam?.movies?.find((movie) => movie.highlight) || heroDetails?.steam?.movies?.[0];

  const continueGames = useMemo(() => {
    const recent = recentIds.map((id) => filtered.find((game) => game.id === id)).filter((game): game is CatalogGame => Boolean(game));
    return recent.length ? recent.slice(0, 8) : filtered.filter((game) => game.copies_available > 0).slice(0, 4);
  }, [recentIds, filtered]);

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
          <div className="wallet-pill"><CircleDollarSign size={17} /><strong>{user.credits.toLocaleString("es-AR")}</strong><span>fichas</span></div>
          <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
        </div>
      </header>

      {!steamOk ? <div className="system-banner">Steam no fue detectado en esta PC. Podés navegar el catálogo, pero descargar y jugar requerirá Steam.</div> : null}
      {offlineDemo ? <div className="system-banner demo"><Sparkles size={15} /> Vista visual activa: el backend local no respondió, así que mostramos datos demo con arte real del catálogo.</div> : null}

      <main>
        {featured ? (
          <section className="hero hero-video" style={featured.hero_image ? { backgroundImage: `url("${featured.hero_image}")` } : undefined}>
            {heroMovie?.mp4 ? <video key={heroMovie.mp4} ref={heroVideoRef} className="hero-video-media" src={heroMovie.mp4} poster={heroMovie.thumbnail} autoPlay={!heroPaused} muted={heroMuted} playsInline loop /> : null}
            <div className="hero-shade" />
            <div className="hero-copy">
              <span className="hero-kicker"><Zap size={15} fill="currentColor" /> AHORA DISPONIBLE EN GAMEACCESS</span>
              <h1>{featured.name}</h1>
              <div className="hero-meta"><span className="green-dot">{availabilityLabel(featured)}</span></div>
              <p>Elegí el juego y empezá. gameAccess verifica disponibilidad, reserva el acceso y prepara la sesión automáticamente.</p>
              <div className="hero-actions glass-actions-row">
                <GlassActionButton icon={<Play size={24} fill="currentColor" />} label="Jugar ahora" tone="play" pulse disabled={featured.copies_available <= 0 || leaseBusy} onClick={() => void doLease(featured)} />
                <button className="secondary-button glass-info-button" onClick={() => setSelected(featured)}><Info size={19} /> Más información</button>
              </div>
            </div>
            <div className="hero-price"><span>Desde</span><strong>{featured.credit_cost_per_hour}</strong><small>fichas / hora</small></div>
            <div className="hero-media-controls" aria-label="Controles del banner">
              <button onClick={previousHero} aria-label="Anterior"><ChevronLeft size={19} /></button>
              <button onClick={toggleHeroPlayback} aria-label={heroPaused ? "Reproducir" : "Pausar"}>{heroPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}</button>
              <button onClick={nextHero} aria-label="Siguiente"><ChevronRight size={19} /></button>
              <button onClick={toggleHeroVolume} aria-label={heroMuted ? "Activar sonido" : "Silenciar"}>{heroMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            </div>
          </section>
        ) : null}

        <div className="content-wrap">
          {loading ? <div className="loading-home"><Loader2 className="spin" /> Cargando biblioteca…</div> : null}
          
          <Shelf title="Seguí donde estabas" subtitle="Tus juegos recientes y preparados" games={continueGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} onOpen={openGame} onPreference={setPreference} />
          <Shelf title="Nuevos lanzamientos" subtitle="Lo más nuevo del catálogo" games={newGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} onOpen={openGame} onPreference={setPreference} />
          <Shelf title="Te pueden gustar" subtitle="Vamos aprendiendo tus gustos con cada pulgar" games={suggestedGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} showPreference onOpen={openGame} onPreference={setPreference} />
        </div>
      </main>

      {selected ? <DetailPanel game={selected} machine={machine} download={selected.app_id ? downloads[selected.app_id] : undefined} onClose={() => setSelected(null)} onLease={doLease} onDownload={startDownload} busy={leaseBusy} /> : null}
      {session ? <SessionOverlay session={session} onClose={() => setSession(null)} /> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
