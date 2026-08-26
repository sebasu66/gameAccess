import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleDollarSign,
  Download,
  Gamepad2,
  Info,
  Loader2,
  Play,
  Search,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";

import { leaseGame, loadDetails, loadHome } from "./api";
import { openSteamInstall, openSteamRun, steamInstalled } from "./native";
import type { CatalogGame, GameDetails, UserSummary } from "./types";

const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type SessionPhase = "reserving" | "preparing" | "launching" | "playing" | "waiting-adapter" | "demo-ready" | "error";

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

function GameCard({ game, onOpen }: { game: CatalogGame; onOpen: (game: CatalogGame) => void }) {
  return (
    <button className="game-card" onClick={() => onOpen(game)} aria-label={`Abrir ${game.name}`}>
      <div className="game-card-art">
        {game.capsule_image ? (
          <img src={game.capsule_image} alt="" loading="lazy" />
        ) : (
          <div className="game-card-fallback"><Gamepad2 size={42} /></div>
        )}
        <div className="game-card-gradient" />
        <span className={`availability-chip ${game.copies_available > 0 ? "ready" : "wait"}`}>
          <span className="dot" /> {availabilityLabel(game)}
        </span>
        <div className="game-card-hover">
          <span className="round-play"><Play size={18} fill="currentColor" /></span>
          <span className="card-price">{game.credit_cost_per_hour} fichas/h</span>
        </div>
      </div>
      <div className="game-card-copy">
        <strong>{game.name}</strong>
        <span>{game.app_id ? "PC · listo para preparar" : "PC · acceso administrado"}</span>
      </div>
    </button>
  );
}

function Shelf({ title, subtitle, games, onOpen }: {
  title: string;
  subtitle?: string;
  games: CatalogGame[];
  onOpen: (game: CatalogGame) => void;
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
        {games.map((game) => <GameCard key={game.id} game={game} onOpen={onOpen} />)}
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
            <span className={session.phase !== "reserving" ? "done" : "current"}>Reserva</span>
            <i />
            <span className={["launching", "playing", "demo-ready", "waiting-adapter"].includes(session.phase) ? "done" : session.phase === "preparing" ? "current" : ""}>Preparación</span>
            <i />
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
  onClose,
  onLease,
  busy,
}: {
  game: CatalogGame;
  onClose: () => void;
  onLease: (game: CatalogGame) => Promise<void>;
  busy: boolean;
}) {
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    setError(null);
    loadDetails(game.id)
      .then((value) => !cancelled && setDetails(value))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [game.id]);

  const steam = details?.steam;
  const description = stripHtml(steam?.short_description || steam?.about_the_game) ||
    "Accedé al juego desde gameAccess. El catálogo, disponibilidad y precio por tiempo se resuelven antes de iniciar la sesión.";
  const hero = steam?.background || steam?.hero_image || game.hero_image || game.header_image || game.capsule_image || undefined;
  const trailer = steam?.movies?.find((movie) => movie.highlight)?.mp4 || steam?.movies?.[0]?.mp4;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <article className="detail-panel" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-detail" onClick={onClose} aria-label="Cerrar"><X size={22} /></button>
        <div className="detail-hero" style={hero ? { backgroundImage: `url("${hero}")` } : undefined}>
          <div className="detail-hero-shade" />
          <div className="detail-hero-copy">
            <span className="eyebrow">GAMEACCESS · PC</span>
            <h1>{steam?.name || game.name}</h1>
            <div className="detail-meta">
              <span className={game.copies_available > 0 ? "meta-ready" : "meta-wait"}>{availabilityLabel(game)}</span>
              <span>{game.credit_cost_per_hour} fichas/hora</span>
              {steam?.release_date ? <span>{steam.release_date}</span> : null}
              {steam?.metacritic?.score ? <span className="score"><Star size={13} fill="currentColor" /> {steam.metacritic.score}</span> : null}
            </div>
            <p>{description}</p>
            <div className="detail-actions">
              <button className="primary-button" disabled={busy || game.copies_available <= 0} onClick={() => onLease(game)}>
                {busy ? <Loader2 size={18} className="spin" /> : <Play size={18} fill="currentColor" />}
                {game.copies_available > 0 ? "Jugar ahora" : "Sin copia disponible"}
              </button>
              <button className="secondary-button" disabled={!game.app_id} onClick={() => game.app_id && openSteamInstall(game.app_id)}>
                <Download size={18} /> Descargar
              </button>
              {trailer ? <a className="secondary-button" href={trailer} target="_blank" rel="noreferrer"><Play size={18} /> Tráiler</a> : null}
            </div>
          </div>
        </div>

        <div className="detail-body">
          {loading ? (
            <div className="loading-line"><Loader2 size={18} className="spin" /> Obteniendo ficha del juego…</div>
          ) : null}
          {error ? <div className="detail-warning">No pudimos cargar la ficha extendida ahora. La biblioteca sigue disponible.</div> : null}

          {steam?.screenshots?.length ? (
            <section className="screenshots-block">
              <div className="section-title"><h3>Capturas</h3><span>{steam.screenshots.length} imágenes</span></div>
              <div className="screenshots-row">
                {steam.screenshots.slice(0, 8).map((shot, index) => (
                  <img key={`${shot.id ?? index}`} src={shot.full || shot.thumbnail} alt={`${game.name} captura ${index + 1}`} loading="lazy" />
                ))}
              </div>
            </section>
          ) : null}

          <div className="detail-grid">
            <section>
              <h3>Acerca del juego</h3>
              <p>{stripHtml(steam?.about_the_game) || description}</p>
            </section>
            <aside>
              {steam?.genres?.length ? <div className="fact"><span>Géneros</span><strong>{steam.genres.slice(0, 4).join(" · ")}</strong></div> : null}
              {steam?.developers?.length ? <div className="fact"><span>Desarrollador</span><strong>{steam.developers.join(", ")}</strong></div> : null}
              {steam?.publishers?.length ? <div className="fact"><span>Publisher</span><strong>{steam.publishers.join(", ")}</strong></div> : null}
              {steam?.recommendation_count ? <div className="fact"><span>Recomendaciones</span><strong>{steam.recommendation_count.toLocaleString("es-AR")}</strong></div> : null}
              {steam?.price?.final_formatted ? <div className="fact"><span>Precio de referencia</span><strong>{steam.price.final_formatted}</strong></div> : null}
            </aside>
          </div>
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

  const refresh = async () => {
    setLoading(true);
    const home = await loadHome();
    setGames(home.games);
    setUser(home.user);
    setOfflineDemo(home.offlineDemo);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    steamInstalled().then(setSteamOk).catch(() => setSteamOk(true));
  }, []);

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

  const available = filtered.filter((game) => game.copies_available > 0);
  const inPool = filtered.filter((game) => game.copies_total > 0);
  const all = filtered;
  const featured = available[0] || filtered[0] || games[0];

  const doLease = async (game: CatalogGame) => {
    setSelected(null);
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
        setSession({
          game,
          phase: "waiting-adapter",
          title: "Reserva lista para el adaptador local",
          detail: "La reserva ya existe. Falta conectar a este cliente el paso local que prepara la sesión de Steam antes de lanzar el juego.",
        });
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSession({ game, phase: "error", title: "No pudimos iniciar la sesión", detail: message });
    } finally {
      setLeaseBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setQuery(""); setSelected(null); }}>
          <span className="brand-mark">g</span>
          <span>game<span>Access</span></span>
        </button>
        <nav>
          <button className="active">Inicio</button>
          <button>Explorar</button>
          <button>Mi lista</button>
        </nav>
        <div className="topbar-actions">
          <label className="search-box">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar juegos" />
            {query ? <button onClick={() => setQuery("")}><X size={15} /></button> : null}
          </label>
          <div className="wallet-pill"><CircleDollarSign size={17} /><strong>{user.credits.toLocaleString("es-AR")}</strong><span>fichas</span></div>
          <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
        </div>
      </header>

      {!steamOk ? <div className="system-banner">Steam no fue detectado en esta PC. Podés navegar el catálogo, pero descargar y jugar requerirá Steam.</div> : null}
      {offlineDemo ? <div className="system-banner demo"><Sparkles size={15} /> Vista visual activa: el backend local no respondió, así que mostramos datos demo con arte real del catálogo.</div> : null}

      <main>
        {featured ? (
          <section className="hero" style={featured.hero_image ? { backgroundImage: `url("${featured.hero_image}")` } : undefined}>
            <div className="hero-shade" />
            <div className="hero-copy">
              <span className="hero-kicker"><Zap size={15} fill="currentColor" /> AHORA DISPONIBLE EN GAMEACCESS</span>
              <h1>{featured.name}</h1>
              <div className="hero-meta" style={{ marginTop: 24 }}>
                <span className="green-dot">{availabilityLabel(featured)}</span>
              </div>
              <p>Elegí el juego y empezá. gameAccess verifica disponibilidad, reserva el acceso y prepara la sesión automáticamente.</p>
              <div className="hero-actions">
                <button className="primary-button" disabled={featured.copies_available <= 0 || leaseBusy} onClick={() => doLease(featured)}>
                  <Play size={19} fill="currentColor" /> Jugar ahora
                </button>
                <button className="secondary-button" onClick={() => setSelected(featured)}><Info size={19} /> Más información</button>
              </div>
            </div>
            <div className="hero-price">
              <span>Desde</span>
              <strong>{featured.credit_cost_per_hour}</strong>
              <small>fichas / hora</small>
            </div>
          </section>
        ) : null}

        <div className="content-wrap">
          {loading ? <div className="loading-home"><Loader2 className="spin" /> Cargando biblioteca…</div> : null}
          {query && !filtered.length ? <div className="empty-state"><Search size={28} /><h2>No encontramos “{query}”</h2><p>Probá con otro nombre o limpiá la búsqueda.</p></div> : null}
          <Shelf title="Jugá ahora" subtitle="Juegos con acceso disponible en este momento" games={available} onOpen={setSelected} />
          <Shelf title="En nuestra biblioteca" subtitle="Títulos preparados para ofrecer acceso desde gameAccess" games={inPool} onOpen={setSelected} />
          <Shelf title="Explorá el catálogo" subtitle="Descubrí, instalá y dejá listo lo que querés jugar" games={all} onOpen={setSelected} />

          <section className="value-strip">
            <div><span className="value-icon"><Download size={21} /></span><div><strong>Descargá primero</strong><p>Dejá el juego preparado antes de reservar tiempo.</p></div></div>
            <div><span className="value-icon"><Zap size={21} /></span><div><strong>Acceso al tocar Jugar</strong><p>Disponibilidad y saldo se validan justo al iniciar.</p></div></div>
            <div><span className="value-icon"><CircleDollarSign size={21} /></span><div><strong>Pagás con fichas</strong><p>Una sola billetera para juegos, promos y recompensas.</p></div></div>
          </section>
        </div>
      </main>

      {selected ? <DetailPanel game={selected} onClose={() => setSelected(null)} onLease={doLease} busy={leaseBusy} /> : null}
      {session ? <SessionOverlay session={session} onClose={() => setSession(null)} /> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
