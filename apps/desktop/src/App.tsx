import { recordPlayed } from "./recentGames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Gamepad2, Info, Loader2, Pause, Play, Search, Sparkles, Volume2, VolumeX } from "lucide-react";

import { leaseGame, loadHome, releaseDownloadFallbackLease, releaseFailedLease } from "./api";
import SteamGlobalSearch from "./SteamGlobalSearch";
import LibraryRoom from "./LibraryRoom";
import { downloadManager } from "./downloadManager";
import { gameStateManager } from "./GameStateManager";
import { GAME_STORAGE_STATE_CHANGED_EVENT, steamFrozenStatuses } from "./gameStorage";
import { getMachineProfile, getVisualDebugConfig, captureVisualDebug, finishVisualDebug, openSteamInstall, openSteamClientInstall, openSteamRun, steamDownloadStatus, steamInstalled, steamInstalledAppIds, steamManagedDownloadStatuses, switchSteamAccount, setVisualDebugViewport, type MachineProfile, type SteamDownloadStatus } from "./native";
import type { CatalogGame, GameDetails, UserSummary } from "./types";

import { wait, inspectVisualChecks, VisualCheck, Preference, DownloadMap, SessionView, releaseScore, GlassActionButton } from "./AppPresentation";
import { Shelf } from "./AppCards";
import { LibrarySphere } from "./AppLibrarySphere";
import { SessionOverlay } from "./AppSessionOverlay";
import { DetailPanel } from "./AppDetailPanel";
let visualDebugStarted = false;

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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const home = await loadHome();
      setGames(home.games); setUser(home.user); setOfflineDemo(home.offlineDemo);
    } catch (error) {
      setToast(`No pudimos actualizar la biblioteca: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    steamInstalled().then(setSteamOk).catch(() => setSteamOk(true));
    getMachineProfile().then(setMachine).catch(() => setMachine(null));
    // Lightweight baseline only: installed AppIDs for green grid badges.
    // Do not load per-game size/progress/details until that game is navigated to.
    steamInstalledAppIds().then((appIds) => {
      const installedMap: DownloadMap = {};
      for (const appId of appIds) {
        installedMap[appId] = {
          app_id: appId, state: "installed", progress: 100,
          bytes_downloaded: null, bytes_total: null, installed: true,
        };
      }
      if (Object.keys(installedMap).length) {
        setDownloads((current) => ({ ...installedMap, ...current }));
      }
    }).catch(() => undefined);
    // Provider download state is durable on disk. Rehydrate it after F5/WebView
    // reload so active downloads and Play-ready prepared games survive React state loss.
    steamManagedDownloadStatuses().then((statuses) => {
      const durableMap: DownloadMap = {};
      for (const status of statuses) {
        durableMap[status.app_id] = status;
      }
      if (Object.keys(durableMap).length) {
        setDownloads((current) => ({ ...current, ...durableMap }));
      }
    }).catch(() => undefined);
    steamFrozenStatuses().then((statuses) => {
      if (!statuses.length) return;
      const frozenMap: DownloadMap = {};
      for (const status of statuses) frozenMap[status.app_id] = status;
      setDownloads((current) => ({ ...current, ...frozenMap }));
    }).catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    const storageStateChanged = (event: Event) => {
      const status = (event as CustomEvent<{ status?: SteamDownloadStatus }>).detail?.status;
      if (!status?.app_id) return;
      setDownloads((current) => ({ ...current, [status.app_id]: status }));
    };
    window.addEventListener(GAME_STORAGE_STATE_CHANGED_EVENT, storageStateChanged);
    return () => window.removeEventListener(GAME_STORAGE_STATE_CHANGED_EVENT, storageStateChanged);
  }, []);

  useEffect(() => {
    const activeIds = Object.entries(downloads)
      .filter(([, status]) => downloadManager.isTracked(status))
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
    const rank = (game: CatalogGame) => {
      if (preferences[game.id] === -1) return 2;
      const status = game.app_id ? downloads[game.app_id] : undefined;
      if (preferences[game.id] === 1 || gameStateManager.resolve(status).playButtonReady) return 0;
      return 1;
    };
    return [...games].sort((left, right) => {
      const rankDelta = rank(left) - rank(right); if (rankDelta) return rankDelta;
      const leftRecent = order.get(left.id); const rightRecent = order.get(right.id);
      if (leftRecent !== undefined || rightRecent !== undefined) return (leftRecent ?? Number.MAX_SAFE_INTEGER) - (rightRecent ?? Number.MAX_SAFE_INTEGER);
      return left.name.localeCompare(right.name, "es");
    });
  }, [games, recentIds, preferences, downloads]);

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
  }, [loading, games, orderedLibrary]);

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

  useEffect(() => {
    const appId = selected?.app_id;
    if (!appId) return;
    let cancelled = false;
    let pending = false;
    const probe = async () => {
      if (pending) return;
      pending = true;
      try {
        const status = await steamDownloadStatus(appId);
        if (!cancelled) setDownloads((current) => ({ ...current, [appId]: status }));
      } catch { /* retain the last known installation state */ }
      finally { pending = false; }
    };
    void probe();
    const timer = window.setInterval(() => void probe(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selected?.app_id]);

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
    const markRequested = () => {
      setDownloads((current) => ({ ...current, [game.app_id!]: { app_id: game.app_id!, state: "requested", progress: null, bytes_downloaded: null, bytes_total: null, installed: false } }));
      rememberRecent(game);
    };
    try {
      await openSteamInstall(game.app_id);
      rememberRecent(game);
      const status = await steamDownloadStatus(game.app_id);
      setDownloads((current) => ({ ...current, [game.app_id!]: status }));
      setToast(status.error ?? "Solicitud aceptada. gameAccess mostrará la preparación y el progreso real.");
    } catch (directError) {
      try {
        const fallbackLease = await leaseGame(game.id, 5);
        try {
          await openSteamClientInstall(game.app_id);
        } finally {
          await releaseDownloadFallbackLease(fallbackLease);
        }
        markRequested();
        setToast("No se pudo usar la descarga directa. gameAccess inició una cuenta proveedora y dejó la descarga a cargo de Steam.");
      } catch (fallbackError) {
        const directMessage = directError instanceof Error ? directError.message : String(directError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        setToast(`Descarga directa: ${directMessage} · Fallback Steam: ${fallbackMessage}`);
      }
    }
  };

  const launchLocal = async (game: CatalogGame) => {
    if (!game.app_id) return;
      const trace = [`Requested AppID = ${game.app_id}`, `Searching verified license-owner mapping for AppID ${game.app_id}`];
      if (!game.local_account_labels?.length || !game.local_primary_account_label) {
        trace.push(`No verified owner is available for AppID ${game.app_id}`);
        setSession({ game, phase: "error", title: "Sin licencia disponible", detail: "El juego está instalado o visible en Steam, pero ninguna cuenta local verificada posee una licencia utilizable.", log: trace });
        setLeaseBusy(false);
        return;
      }
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
        recordPlayed(game.app_id);
        trace.push("Launch command accepted");
        setSession({ game, phase: "playing", title: "¡A jugar!", detail: "El juego se inició usando la cuenta propietaria verificada.", log: [...trace] });
      } catch (err) {
        trace.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        setSession({ game, phase: "error", title: "No pudimos iniciar la sesión local", detail: err instanceof Error ? err.message : String(err), log: [...trace] });
      } finally {
        setLeaseBusy(false);
      }

  };

  const doLease = async (game: CatalogGame) => {
    setSelected(null);
    rememberRecent(game);
    setLeaseBusy(true);
    setSession({ game, phase: "reserving", title: "Buscando una copia disponible", detail: "Estamos reservando una licencia disponible para esta sesión." });

    if (hasLocalRoute(game)) {
      await launchLocal(game);
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

    let leaseForRollback: Awaited<ReturnType<typeof leaseGame>> | null = null;
    try {
      const lease = await leaseGame(game.id, 60);
      leaseForRollback = lease;
      setUser((current) => ({ ...current, credits: lease.credits_remaining }));
      setSession({ game, phase: "preparing", title: "Reserva confirmada", detail: "Ahora gameAccess prepara la sesión de juego asignada a esta reserva." });
      if (lease.session_action === "launch_ready" && lease.game.app_id) {
        await wait(450);
        setSession({ game, phase: "launching", title: "Abriendo el juego", detail: "Todo está listo. Estamos iniciando el juego en esta PC." });
        await openSteamRun(lease.game.app_id);
        recordPlayed(lease.game.app_id);
        // The launch command was accepted; from here this is a live session, not rollback work.
        leaseForRollback = null;
        await wait(450);
        setSession({ game, phase: "playing", title: "¡A jugar!", detail: "La sesión está activa. El tiempo reservado ya está asociado a tu partida." });
      } else {
        // A waiting adapter intentionally owns the reservation.
        leaseForRollback = null;
        setSession({ game, phase: "waiting-adapter", title: "Reserva lista para el adaptador local", detail: "La reserva ya existe. Falta conectar a este cliente el paso local que prepara la sesión de Steam antes de lanzar el juego." });
      }
      await refresh();
    } catch (err) {
      if (leaseForRollback) {
        await releaseFailedLease(leaseForRollback);
        leaseForRollback = null;
        await refresh().catch(() => undefined);
      }
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

  const moveMagazineFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    const columns = magazineShape.columns;
    const moves: Record<string, number> = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1, ArrowUp: -columns, w: -columns, W: -columns, ArrowDown: columns, s: columns, S: columns };
    const movement = moves[event.key];
    if (!movement || !magazineGames.length) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(magazineGames.length - 1, magazineFocus + movement));
    setMagazineFocus(next);
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-magazine-index="${next}"]`)?.focus());
  };

  const renderMagazine = () => (<>{featured ? (
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
                <button type="button" className="secondary-button glass-info-button" onClick={() => setSelected(featured)}><Info size={19} /> Más información</button>
              </div>
            </div>
            <section  className="hero-media-controls" aria-label="Controles del banner">
              <button type="button" onClick={previousHero} aria-label="Anterior"><ChevronLeft size={19} /></button>
              <button type="button" onClick={toggleHeroPlayback} aria-label={heroPaused ? "Reproducir" : "Pausar"}>{heroPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}</button>
              <button type="button" onClick={nextHero} aria-label="Siguiente"><ChevronRight size={19} /></button>
              <button type="button" onClick={toggleHeroVolume} aria-label={heroMuted ? "Activar sonido" : "Silenciar"}>{heroMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            </section>
          </div>
          <section ref={magazineCatalogRef} className="magazine-catalog" aria-label="Juegos recientes y favoritos">
            <div className="magazine-heading"><div><span className="eyebrow">RECIENTES Y FAVORITOS</span><h2>Elegí un juego</h2></div><button type="button" className="sphere-view-button" onClick={() => setLibraryOpen(true)} aria-label="Cambiar a vista esfera"><span /></button></div>
            <div className="magazine-grid" style={{ "--magazine-columns": magazineShape.columns, "--magazine-rows": magazineShape.rows } as React.CSSProperties}>
              {magazineGames.map((game, index) => <div key={game.id} className={index === magazineFocus ? "magazine-item is-focused" : "magazine-item"}><button type="button" className="magazine-card" onFocus={() => setMagazineFocus(index)} onKeyDown={moveMagazineFocus} data-magazine-index={index} onClick={() => openGame(game)} aria-label={`Abrir ${game.name}`}><span className="magazine-card-art">{game.capsule_image ? <img src={game.capsule_image} alt="" loading="lazy" /> : <Gamepad2 size={34} />}</span><span className="magazine-card-title">{game.name}</span></button></div>)}
            </div>
          </section>
          <div className="screen-controls-hint"><span>NAVEGAR · WASD / FLECHAS</span><span>DETALLES · ENTER</span><span>BUSCAR · CTRL+F</span></div>
          </section>
        ) : null}

        </>);

  return (
    <div className="app-shell">
      <header className="topbar topbar-glass">
        <button type="button" className="brand" onClick={() => { setQuery(""); setSelected(null); }}><span className="brand-mark">g</span><span>game<span>Access</span></span></button>
        <nav className="glass-nav">
          <button type="button" className="glass-static-nav active"><span>Inicio</span></button>
          <button type="button" className="glass-static-nav"><span>Explorar</span></button>
          <button type="button" className="glass-static-nav"><span>Mi lista</span></button>
        </nav>
        <div className="topbar-actions">
          <SteamGlobalSearch query={query} setQuery={setQuery} onOpenCatalogGame={openGame} />
          <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
        </div>
      </header>

      {!steamOk ? <div className="system-banner">Steam no fue detectado en esta PC. Podés navegar el catálogo, pero descargar y jugar requerirá Steam.</div> : null}
      {offlineDemo ? <div className="system-banner demo"><Sparkles size={15} /> No se pudo comunicar con el servidor de GameAccess. La biblioteca local y Store siguen disponibles; el catálogo de GameAccess volverá cuando haya conexión.</div> : null}

      <main>
        <LibraryRoom games={orderedLibrary} downloads={downloads} busy={leaseBusy} loading={loading} onPlay={doLease} onDownload={startDownload} preferences={preferences} onPreference={setPreference} />
        {renderMagazine()}
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

function hasLocalRoute(game: CatalogGame) {
  return Boolean((game.local_access_labels?.length || game.local_account_labels?.length) && game.app_id);
}
