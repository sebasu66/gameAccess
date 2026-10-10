import { ACTIVATION_CHANGED_EVENT } from "./activation";
import VoxelLogo from "./VoxelLogo";
import FilledIcon from "./FilledIcon";
import { useSteamMetadataWorker } from "./useSteamMetadataWorker";
import { applyInstalledSnapshot, STORAGE_SNAPSHOT_EVENT } from "./libraryStorageSnapshot";
import { recordPlayed } from "./recentGames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Gamepad2, Info, Loader2, Pause, Play, Search, Sparkles, Volume2, VolumeX } from "lucide-react";

import { loadHome } from "./api";
import { useCatalogSources } from "./useCatalogSources";
import { EMPTY_LIBRARY_FILTERS } from "./librarySearch";
import type { LibrarySearchFilters } from "./librarySearch";
import LibraryRoom from "./LibraryRoom";
import { downloadManager } from "./downloadManager";
import { gameStateManager } from "./GameStateManager";
import { GAME_STORAGE_STATE_CHANGED_EVENT } from "./gameStorage";
import { getMachineProfile, getVisualDebugConfig, captureVisualDebug, finishVisualDebug, openSteamRun, steamDownloadStatus, steamInstalledAppIds, setVisualDebugViewport, type MachineProfile } from "./native";
import type { CatalogGame, GameDetails, UserSummary } from "./types";

import { wait, inspectVisualChecks, VisualCheck, Preference, DownloadMap, SessionView, releaseScore, GlassActionButton } from "./AppPresentation";
import { Shelf } from "./AppCards";
import { LibrarySphere } from "./AppLibrarySphere";
import { SessionOverlay } from "./AppSessionOverlay";
import { DetailPanel } from "./AppDetailPanel";
import { getCatalogMode } from "./catalogMode";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import DigitalDownloadsScreen from "./DigitalDownloadsScreen";
import DigitalDownloadToast from "./DigitalDownloadToast";
import CatalogNewGameNotices from "./CatalogNewGameNotices";
import { useCatalogUpdates } from "./useCatalogUpdates";
import {translate,useI18n} from "./i18n";
import DigitalDownloadErrorDialog from "./DigitalDownloadErrorDialog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { narrate } from "./narrationLog";
import { PluginIndicator } from "./PluginIndicator";
let visualDebugStarted = false;

const isPendingSteamMetadata = (game: CatalogGame) =>
  Boolean(game.app_id) && new RegExp(`^Steam\s+${game.app_id}$`, "i").test(game.name.trim());

function playToastBeep(): void {
  try {
    const AudioContextCtor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
    oscillator.onended = () => { void context.close(); };
  } catch {
    // The visual notification is authoritative; audio is optional.
  }
}

export default function App({ catalogNavigation, actionsTarget }: { catalogNavigation?: React.ReactNode; actionsTarget?: HTMLDivElement | null }) {
  const {t}=useI18n();
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = () => document.documentElement.style.setProperty("--catalog-header-height", `${header.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--catalog-header-height"); };
  }, []);
  const [games, setGames] = useState<CatalogGame[]>([]);
  useSteamMetadataWorker(games, setGames);
  const [user, setUser] = useState<UserSummary>({ id: 1, username: "demo", credits: 0 });
  const [offlineDemo, setOfflineDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  useCatalogSources(games, setGames);
  useEffect(() => {
    const changed = () => void digitalDownloadService.refreshParallelLimit();
    window.addEventListener(ACTIVATION_CHANGED_EVENT, changed);
    return () => window.removeEventListener(ACTIVATION_CHANGED_EVENT, changed);
  }, []);

  const [query, setQuery] = useState("");
  const [searchFilters, setSearchFilters] = useState<LibrarySearchFilters>(EMPTY_LIBRARY_FILTERS);
  const [selected, setSelected] = useState<CatalogGame | null>(null);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const catalogUpdates = useCatalogUpdates(games, !loading && !offlineDemo,
    getCatalogMode() === "digital" && !["tablet", "display"].includes(new URLSearchParams(window.location.search).get("surface") ?? ""), setGames, setToast);
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
    const startedAt = performance.now();
    void narrate("Library catalog refresh started.", { area: "CATALOG" });
    setLoading(true);
    try {
      const home = await loadHome();
      setGames(home.games); setUser(home.user); setOfflineDemo(home.offlineDemo);
      void narrate(`Library catalog refresh completed with ${home.games.length} game(s) in ${Math.round(performance.now() - startedAt)} ms.`, { area: "CATALOG" });
    } catch (error) {
      setOfflineDemo(true);
      void narrate(`Library catalog refresh failed after ${Math.round(performance.now() - startedAt)} ms: ${error instanceof Error ? error.message : String(error)}.`, { area: "CATALOG", level: "ERROR" });
      setToast(`No pudimos actualizar la biblioteca: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    getMachineProfile().then(setMachine).catch(() => setMachine(null));
    const restored: DownloadMap = {};
    for (const { snapshot } of digitalDownloadService.getDownloads()) {
      const status = digitalDownloadService.getManagedStatus(snapshot.gameId);
      if (status) restored[snapshot.gameId] = status;
    }
    setDownloads(restored);
    if (getCatalogMode() === "local") steamInstalledAppIds().then(ids => setDownloads(current => applyInstalledSnapshot(current, ids))).catch(() => undefined);
  }, [refresh]);

  const hasPendingSteamMetadata = useMemo(() => games.some(isPendingSteamMetadata), [games]);

  useEffect(() => {
    if (!hasPendingSteamMetadata) return;
    let cancelled = false;
    let inFlight = false;
    const refreshPendingMetadata = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const home = await loadHome();
        if (cancelled) return;
        setGames(home.games);
        setUser(home.user);
        setOfflineDemo(home.offlineDemo);
        setSelected((current) => {
          if (!current) return null;
          return home.games.find((game) => game.id === current.id) ?? null;
        });
      } catch {
        // Metadata enrichment is best-effort. Keep the current library visible.
      } finally {
        inFlight = false;
      }
    };
    void refreshPendingMetadata();
    const timer = window.setInterval(() => void refreshPendingMetadata(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasPendingSteamMetadata]);

  useEffect(() => {
    if (getCatalogMode() !== "digital") return;
    const unsub = digitalDownloadService.onGlobalUpdate((snapshot) => {
      const managed = digitalDownloadService.getManagedStatus(snapshot.gameId);
      if (managed) {
        setDownloads((current) => ({
          ...current,
          [snapshot.gameId]: managed,
          ...(managed.app_id ? { [managed.app_id]: managed } : {})
        }));
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (getCatalogMode() !== "digital" || !games.length) return;
    let cancelled = false;
    let pending = false;
    const refreshDigital = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await digitalProcessManager.snapshot(games);
        if (!cancelled) setDownloads(current => {
          const next = { ...current };
          for (const game of games) {
            const id = game.app_id ?? game.id;
            const active = digitalDownloadService.getManagedStatus(id);
            if (active && !["installed", "not-installed"].includes(active.state)) continue;
            const installed = Boolean(result.statuses?.[id]?.installed);
            next[id] = { app_id: id, state: installed ? "installed" : "not-installed", progress: installed ? 100 : null,
              bytes_downloaded: null, bytes_total: null, installed };
          }
          return next;
        });
      } catch { /* Keep last confirmed folder state on probe errors. */ }
      finally { pending = false; }
    };
    void refreshDigital();
    const timer = window.setInterval(() => void refreshDigital(), 15000);
    window.addEventListener("focus", refreshDigital);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refreshDigital); };
  }, [games]);

  useEffect(() => {
    if (!toast) return;
    playToastBeep();
    const timer = window.setTimeout(() => setToast(null), 6000);
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
          { selector: ".library-catalog-toolbar .global-search", label: "Library search", minWidth: 220, minHeight: 36 },
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
        setSession({ game: firstGame, phase: "demo-ready", title: "Sesión de depuración visual", detail: "Estado de prueba usado únicamente para validar el diálogo de sesión." });
        await captureStep(profile, "session-dialog", [
          { selector: ".session-card", label: "Session dialog", minWidth: 360, minHeight: 260 },
          { selector: ".session-card button", label: "Session dialog action", minWidth: 32, minHeight: 32 },
        ]);
      }
      setSession(null); setSelected(null); setLibraryOpen(false);
      const manifest = await finishVisualDebug({ session_dir: config.session_dir, created_at: new Date().toISOString(), results });
      setToast(`Depuración visual completada: ${manifest}`);
    };
    void run().catch((error) => setToast(`La depuración visual falló: ${error instanceof Error ? error.message : String(error)}`));
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
  const featuredPlayReady = gameStateManager.isPlayButtonReady(downloads[Number(featured?.app_id)]);

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
        const status = getCatalogMode() === "local" ? await steamDownloadStatus(appId) : await digitalCatalogService.getStatus(selected!);
        if (!cancelled) setDownloads((current) => ({ ...current, [appId]: status }));
      } catch { /* retain the last known installation state */ }
      finally { pending = false; }
    };
    void probe();
    const timer = window.setInterval(() => void probe(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selected?.app_id]);

  const openGame = (game: CatalogGame) => {
    void narrate(`Game details opened for '${game.name}' (catalog game ${game.id}, Steam AppID ${game.app_id ?? "unknown"}).`, { area: "GAME" });
    setSelected(game);
  };

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
    setToast(value === 1 ? (next[gameId] === 1 ? "Añadido a favoritos." : "Quitado de favoritos.") : "Perfecto, veremos menos juegos de este estilo.");
  };

  const startDownload = async (game: CatalogGame) => {
    try { await digitalCatalogService.download(game); }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      digitalDownloadService.recordFailure(game, message); setToast(message);
    }
  };

  const doLease = async (game: CatalogGame) => {
    document.querySelectorAll("video").forEach(video => video.pause());
    setHeroPaused(true); setSelected(null); rememberRecent(game); setLeaseBusy(true);
    setSession({ game, phase: "launching", title: translate("launchTitle"), detail: translate("launchDetail") });
    try {
      if (getCatalogMode() === "local" && game.app_id) await openSteamRun(game.app_id);
      else await digitalCatalogService.play(game);
      if (game.app_id) recordPlayed(game.app_id);
      setSession({ game, phase: "playing", title: translate("launchReady"), detail: translate("launchStarted") });
    } catch (err) {
      setSession({ game, phase: "error", title: translate("launchError"), detail: err instanceof Error ? err.message : String(err) });
    } finally { setLeaseBusy(false); }
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
                <GlassActionButton icon={<Play size={24} fill="currentColor" />} label="Jugar ahora" tone="play" pulse disabled={!featuredPlayReady || leaseBusy} onClick={() => void doLease(featured)} />
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
      <header ref={headerRef} className="topbar topbar-glass">
        <button type="button" className="brand" aria-label="GameAccess" onClick={() => { setQuery(""); setSelected(null); }}><VoxelLogo /></button>
        {catalogNavigation}
        <div className="catalog-header-controls" ref={setToolbarTarget} />
      </header>
        <div className="topbar-actions">
          <PluginIndicator />
          {<button type="button" className="digital-download-nav" aria-pressed={downloadsOpen} onClick={() => { setSelected(null); setDownloadsOpen(open => !open); }}><FilledIcon name="download" /> {t("downloadsTitle")}</button>}
          <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
        </div>

      {offlineDemo ? <div className="system-banner demo"><Sparkles size={15} /> No se pudo comunicar con el servidor de GameAccess. La biblioteca local y Tienda siguen disponibles; el catálogo de GameAccess volverá cuando haya conexión.</div> : null}

      <main>
        <LibraryRoom toolbarTarget={toolbarTarget} actionsTarget={actionsTarget} games={orderedLibrary} downloads={downloads} busy={leaseBusy} loading={loading} catalogUnavailable={offlineDemo} onPlay={doLease} onDownload={startDownload} preferences={preferences} onPreference={setPreference} searchFilters={searchFilters} onSearchFiltersChange={setSearchFilters} searchValue={query} onSearchQueryChange={setQuery} />
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
      {downloadsOpen ? <DigitalDownloadsScreen catalogGames={games} onClose={() => setDownloadsOpen(false)} onPlay={async game => { setDownloadsOpen(false); await doLease(game); }} /> : null}

      {selected ? <DetailPanel game={selected} machine={machine} download={(selected.app_id ? downloads[selected.app_id] : undefined) ?? downloads[selected.id]} onClose={() => setSelected(null)} onLease={doLease} onDownload={startDownload} busy={leaseBusy} overLibrary={libraryOpen} /> : null}
      {libraryOpen ? <LibrarySphere games={orderedLibrary} query={libraryQuery} setQuery={setLibraryQuery} searchFilters={searchFilters} onSearchFiltersChange={setSearchFilters} onOpen={openGame} onClose={() => setLibraryOpen(false)} detailOpen={Boolean(selected)} /> : null}
      {session ? <SessionOverlay session={session} onClose={() => setSession(null)} /> : null}
      <DigitalDownloadErrorDialog />
      <CatalogNewGameNotices notices={catalogUpdates.notices} dismiss={catalogUpdates.dismiss}/>
      {!downloadsOpen && !selected ? <DigitalDownloadToast onOpen={() => { setSelected(null); setDownloadsOpen(true); }} /> : null}
      {toast ? <div className="toast" role="status" aria-live="assertive">{toast}</div> : null}
    </div>
  );
}

