import { personalOrderState } from "./personalOrder";
import { buildTasteProfile, rememberTasteGame, tasteProgressText } from "./tasteProfile";
import AppSettings from "./AppSettings";
import AppHelp from "./AppHelp";
import ParentalSetupDialog from "./ParentalSetupDialog";
import { startAutoFreeze } from "./autoFreeze";
import { useParentalState } from "./ParentalControlSection";
import RenderProbe from "./RenderProbe";
import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import { libraryMembership, useLibraryGames } from "./libraryMembership";
import { ACTIVATION_CHANGED_EVENT, getActivationTier } from "./activation";
import DeviceFrame, { deviceFrameEnabled } from "./DeviceFrame";
import FilledIcon from "./FilledIcon";
import { applyInstalledSnapshot, STORAGE_SNAPSHOT_EVENT } from "./libraryStorageSnapshot";
import { recordPlayed } from "./recentGames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Gamepad2, Info, Loader2, Pause, Play, Search, Sparkles, Volume2, VolumeX } from "lucide-react";

import { loadHome } from "./api";
import { useCoverDiagnostics } from "./SteamCover";
import { useCatalogSources } from "./useCatalogSources";
import { INITIAL_CATALOG_FILTERS } from "./librarySearch";
import { HERO_AUTOPLAY } from "./featureModes";
import type { LibrarySearchFilters } from "./librarySearch";
import LibraryRoom from "./LibraryRoom";
import { downloadManager } from "./downloadManager";
import { gameStateManager } from "./GameStateManager";
import { GAME_STORAGE_STATE_CHANGED_EVENT } from "./gameStorage";
import { hasTauriRuntime, getMachineProfile, getVisualDebugConfig, captureVisualDebug, finishVisualDebug, openSteamRun, steamDownloadStatus, steamInstalledAppIds, setVisualDebugViewport, type MachineProfile } from "./native";
import type { CatalogGame, GameDetails, UserSummary } from "./types";

import { queryCatalogCache } from "./catalogCache";
import { wait, inspectVisualChecks, VisualCheck, Preference, DownloadMap, SessionView, GlassActionButton } from "./AppPresentation";
import { Shelf } from "./AppCards";
import { LibrarySphere } from "./AppLibrarySphere";
import { SessionOverlay } from "./AppSessionOverlay";
import { hideNotice, runSteps, showNotice } from "./notice/notice";
import { noticeGame } from "./notice/noticeGame";
import { getCatalogMode } from "./catalogMode";
import { libraryScanState, scanLibrary } from "./libraryScan";
import { GAME_ENDED_EVENT, useGridFocus, watchGameFocus } from "./gameFocus";
import { cancelFreezeJob, freezeJob, guardAppClose, pauseFreezesWhilePlaying, recoverFreezes, resumeFreezes } from "./freezeJobs";
import { digitalCatalogService, GameAlreadyInstalledError } from "./catalog/DigitalCatalog";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import DigitalDownloadsScreen from "./DigitalDownloadsScreen";
import DeskPanel from "./desk/DeskPanel";
import NewsPanel from "./NewsPanel";
import { uiDemo } from "./devDemo/uiDemo";
import { demoDownloadService } from "./devDemo/demoDownloads";
import { closePanel, isWideDesk, openPanel, togglePanel, useDesk, useDeskLayout } from "./desk/desk";
import DigitalDownloadToast from "./DigitalDownloadToast";
import FreezeConsole from "./FreezeConsole";
import CatalogNewGameNotices from "./CatalogNewGameNotices";
import { useCatalogUpdates } from "./useCatalogUpdates";
import {translate,useI18n} from "./i18n";
import DigitalDownloadErrorDialog from "./DigitalDownloadErrorDialog";
import GameRecoveryDialog, { isBrokenInstall } from "./GameRecoveryDialog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { narrate } from "./narrationLog";
import { notify } from "./toasts";
import { installThroughSteam, isSteamOwned, steamOwnerLabel, syncSteamOnStartup } from "./steamLibrary";
import { GaIconButton } from "./components/ga/Buttons";
let visualDebugStarted = false;

const isPendingSteamMetadata = (game: CatalogGame) =>
  Boolean(game.app_id) && new RegExp(`^Steam\s+${game.app_id}$`, "i").test(game.name.trim());

export default function App({ catalogNavigation, actionsTarget, dockTarget = null }: { catalogNavigation?: React.ReactNode; actionsTarget?: HTMLDivElement | null; dockTarget?: HTMLElement | null }) {
  const {t}=useI18n();
  // The Library Manager scans the games folder when the app starts; cards show what is outside the standard.
  // Then the Steam library joins it (installed games linked to their owner account, owned ones to install via Steam).
  useEffect(() => { if (getCatalogMode() === "digital") void scanLibrary().then(() => syncSteamOnStartup()); }, []);
  const downloadsOpen = useDesk().includes("downloads");
  const [unfinishedDownloads, setUnfinishedDownloads] = useState(0);
  const pendingNoticeShown = useRef(false);
  // Dev-only browser preview: a download that walks through its steps (`?uiDemo=1`).
  const demoService = useRef<ReturnType<typeof demoDownloadService>>();
  if (import.meta.env.DEV && uiDemo() && !demoService.current) demoService.current = demoDownloadService();
  useDeskLayout();
  // The grid has the focus when the app is activated and when a game ends (gameFocus.ts).
  useGridFocus();
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
  const libraryGames = useLibraryGames();
  const [games, setGames] = useState<CatalogGame[]>([]);
  const [user, setUser] = useState<UserSummary>({ id: 1, username: "demo", credits: 0 });
  const [offlineDemo, setOfflineDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  useCatalogSources(games, setGames);
  useCoverDiagnostics();
  useEffect(() => {
    const changed = () => void digitalDownloadService.refreshParallelLimit();
    window.addEventListener(ACTIVATION_CHANGED_EVENT, changed);
    return () => window.removeEventListener(ACTIVATION_CHANGED_EVENT, changed);
  }, []);

  const [query, setQuery] = useState("");
  const [searchFilters, setSearchFilters] = useState<LibrarySearchFilters>(() => ({ ...INITIAL_CATALOG_FILTERS }));
  const [selected, setSelected] = useState<CatalogGame | null>(null);
  const [launchBusy, setLaunchBusy] = useState(false);
  const gameEndedStop = useRef<(() => void) | null>(null);
  // Every message goes through the single notice (see src/notice).
  const setToast = useCallback((message: string | null) => { if (message) notify(message); }, []);
  const catalogUpdates = useCatalogUpdates(games, !loading && !offlineDemo,
    getCatalogMode() === "digital", setGames, setToast);
  const [session, setSession] = useState<SessionView | null>(null);
  const [brokenGame, setBrokenGame] = useState<{ game: CatalogGame; message: string } | null>(null);
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
      setToast(t("libraryRefreshFailed", { error: error instanceof Error ? error.message : String(error) }));
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
    let delay = 5000;
    let timer = 0;
    let known = { total: -1, pending: -1 };
    const refreshPendingMetadata = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const home = await loadHome();
        if (cancelled) return;
        // Re-rendering the whole catalog costs about a second, so only do it when something actually got enriched.
        const next = { total: home.games.length, pending: home.games.filter(isPendingSteamMetadata).length };
        const changed = next.total !== known.total || next.pending !== known.pending;
        known = next;
        delay = changed ? 5000 : Math.min(delay * 2, 120_000);
        if (!changed) return;
        setGames(home.games);
        setUser(home.user);
        setOfflineDemo(home.offlineDemo);
        setSelected((current) => {
          if (!current) return null;
          return home.games.find((game) => game.id === current.id) ?? current;
        });
      } catch {
        // Metadata enrichment is best-effort. Keep the current library visible.
      } finally {
        inFlight = false;
      }
    };
    const loop = async () => {
      await refreshPendingMetadata();
      if (!cancelled) timer = window.setTimeout(() => void loop(), delay);
    };
    void loop();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasPendingSteamMetadata]);

  useEffect(() => {
    if (getCatalogMode() !== "digital") return;
    // Every active download reports once a second. Applying each report on its own
    // re-rendered the whole library several times a second, so progress ticks are
    // merged into one state update per second; a phase change still applies at once.
    const pendingIds = new Set<number>();
    const lastPhase = new Map<number, string>();
    let timer: number | null = null;
    const flush = () => {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      const ids = [...pendingIds];
      pendingIds.clear();
      const updates: Array<[number, NonNullable<ReturnType<typeof digitalDownloadService.getManagedStatus>>]> = [];
      for (const id of ids) {
        const managed = digitalDownloadService.getManagedStatus(id);
        if (managed) updates.push([id, managed]);
      }
      if (!updates.length) return;
      setDownloads((current) => {
        const next = { ...current };
        for (const [id, managed] of updates) {
          next[id] = managed;
          if (managed.app_id) next[managed.app_id] = managed;
        }
        return next;
      });
    };
    const unsub = digitalDownloadService.onGlobalUpdate((snapshot) => {
      pendingIds.add(snapshot.gameId);
      const phaseChanged = lastPhase.get(snapshot.gameId) !== snapshot.phase;
      lastPhase.set(snapshot.gameId, snapshot.phase);
      setUnfinishedDownloads(digitalDownloadService.unfinishedCount());
      if (phaseChanged) flush();
      else if (timer === null) timer = window.setTimeout(flush, 1000);
    });
    return () => { unsub(); if (timer !== null) window.clearTimeout(timer); };
  }, []);

  // Once per launch, tell the player when downloads were left unfinished (paused, stopped for lack of room...).
  useEffect(() => {
    if (!unfinishedDownloads || pendingNoticeShown.current) return;
    pendingNoticeShown.current = true;
    showNotice({ tone: "info", title: t("pendingDownloadsNotice", { count: unfinishedDownloads }), actions: [{ label: t("pendingDownloadsOpen"), kind: "primary", run: () => { hideNotice(); setSelected(null); openPanel("downloads"); } }, { label: t("close"), kind: "secondary", run: () => hideNotice() }] });
  }, [unfinishedDownloads, t]);

  // Source/metadata updates do not change the folders we need to check.
  const digitalFolderKey = useMemo(() => JSON.stringify(games.map(game => [game.app_id ?? game.id, game.name])), [games]);
  const digitalGamesRef = useRef(games);
  digitalGamesRef.current = games;
  useEffect(() => {
    if (getCatalogMode() !== "digital" || !digitalGamesRef.current.length) return;
    let cancelled = false;
    let pending = false;
    const refreshDigital = async () => {
      if (pending) return;
      pending = true;
      try {
        const games = digitalGamesRef.current;
        const result = await digitalProcessManager.snapshot(games);
        if (!cancelled) libraryMembership.migrate([
          ...games.filter(game => result.statuses?.[game.app_id ?? game.id]?.installed),
          ...digitalDownloadService.getDownloads().map(entry => entry.game),
        ]);
        // Every game with a folder in the games root is part of the library: whatever the manager sees, the library shows.
        if (!cancelled) for (const game of games) {
          const id = game.app_id ?? game.id;
          if (result.statuses?.[id] && !libraryMembership.has(game)) { try { libraryMembership.add(game); } catch { /* busy: next pass */ } }
        }
        if (!cancelled) setDownloads(current => {
          // Keep the same object when nothing changed: a new one re-renders the whole catalog (about a second).
          let next: typeof current | null = null;
          for (const game of games) {
            const id = game.app_id ?? game.id;
            const active = digitalDownloadService.getManagedStatus(id);
            if (active && !["installed", "not-installed"].includes(active.state)) continue;
            const installed = Boolean(result.statuses?.[id]?.installed);
            const state = installed ? "installed" : "not-installed";
            const existing = current[id];
            if (existing && existing.state === state && Boolean(existing.installed) === installed && existing.bytes_downloaded === null) continue;
            next ??= { ...current };
            next[id] = { app_id: id, state, progress: installed ? 100 : null,
              bytes_downloaded: null, bytes_total: null, installed };
          }
          return next ?? current;
        });
      } catch { /* Keep last confirmed folder state on probe errors. */ }
      finally { pending = false; }
    };
    void refreshDigital();
    const timer = window.setInterval(() => void refreshDigital(), 15000);
    window.addEventListener("focus", refreshDigital);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refreshDigital); };
  }, [digitalFolderKey]);

  const relevantCatalogGames = useMemo(() => {
    const activeAppIds = new Set([
      ...Object.keys(downloads).map(Number),
      ...Object.keys(preferences).map(Number),
      ...recentIds,
    ]);
    return games.filter(g => activeAppIds.has(g.id) || (g.app_id != null && activeAppIds.has(g.app_id)));
  }, [games, downloads, preferences, recentIds]);

  const orderedLibrary = useMemo(() => {
    const order = new Map(recentIds.map((id, index) => [id, index]));
    const rank = (game: CatalogGame) => {
      if (preferences[game.id] === -1) return 2;
      const status = game.app_id ? downloads[game.app_id] : undefined;
      if (preferences[game.id] === 1 || gameStateManager.resolve(status).playButtonReady) return 0;
      return 1;
    };
    const combined = new Map([...libraryGames, ...relevantCatalogGames].map(game => [game.app_id ?? game.id, game]));
    return [...combined.values()].sort((left, right) => {
      const rankDelta = rank(left) - rank(right); if (rankDelta) return rankDelta;
      const leftRecent = order.get(left.id); const rightRecent = order.get(right.id);
      if (leftRecent !== undefined || rightRecent !== undefined) return (leftRecent ?? Number.MAX_SAFE_INTEGER) - (rightRecent ?? Number.MAX_SAFE_INTEGER);
      return left.name.localeCompare(right.name, "es");
    });
  }, [libraryGames, relevantCatalogGames, recentIds, preferences, downloads]);

  const [newGames, setNewGames] = useState<CatalogGame[]>([]);
  const [suggestedGames, setSuggestedGames] = useState<CatalogGame[]>([]);

  useEffect(() => startAutoFreeze(), []);
  // A freeze cut short by a closed app is put right and told; closing the app with one going on asks first.
  useEffect(() => { if (getCatalogMode() === "digital") void recoverFreezes(); guardAppClose(); }, []);

  // The shelves are asked again when the parental policy changes (queryCatalogCache applies it).
  const parentalPolicy = useParentalState().policy;
  useEffect(() => {
    if (loading) return;
    void queryCatalogCache({ sort_by: "release-date", sort_direction: "desc", limit: 10 })
      .then(res => setNewGames(res.items))
      .catch(() => {});
    void queryCatalogCache({ sort_by: "steam-review-score", sort_direction: "desc", limit: 12 })
      .then(res => setSuggestedGames(res.items))
      .catch(() => {});
  }, [loading, parentalPolicy]);

  const heroPool = useMemo(() => {
    const base = orderedLibrary.length ? orderedLibrary : (newGames.length ? newGames : suggestedGames);
    return [...base].slice(0, 6);
  }, [orderedLibrary, newGames, suggestedGames]);

  useEffect(() => {
    if (heroIndex >= heroPool.length) setHeroIndex(0);
  }, [heroIndex, heroPool.length]);

  useEffect(() => {
    // Rotation is off until HERO_AUTOPLAY is enabled: advancing the featured game
    // every 18 seconds moves the page while the user is reading it.
    if (!HERO_AUTOPLAY || heroPaused || heroPool.length < 2) return;
    const timer = window.setInterval(() => setHeroIndex((current) => (current + 1) % heroPool.length), 18000);
    return () => window.clearInterval(timer);
  }, [heroPaused, heroPool.length]);


  const continueGames = useMemo(() => {
    const recent = recentIds.map((id) => orderedLibrary.find((game) => game.id === id)).filter((game): game is CatalogGame => Boolean(game));
    return recent.length ? recent.slice(0, 8) : orderedLibrary.filter((game) => game.copies_available > 0).slice(0, 4);
  }, [recentIds, orderedLibrary]);

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
          { selector: ".ga-detail-dialog", label: "Game details", minWidth: 600, minHeight: 500, mustFitWidth: true },
          { selector: ".ga-detail-close", label: "Details close", minWidth: 36, minHeight: 36 },
          { selector: ".ga-detail-more", label: "Game options", minWidth: 36, minHeight: 36 },
          { selector: ".library-room-overview h1", label: "Game title", minWidth: 120, minHeight: 30 },
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
      setToast(t("visualDebugDone", { manifest }));
    };
    void run().catch((error) => setToast(t("visualDebugFailed", { error: error instanceof Error ? error.message : String(error) })));
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
  const featured = magazineGames[magazineFocus] || heroPool[heroIndex] || orderedLibrary[0] || games[0];
  const heroDetails = featured ? detailsById[featured.id] : undefined;
  const heroMovie = heroDetails?.steam?.movies?.find((movie) => movie.highlight) || heroDetails?.steam?.movies?.[0];
  const featuredPlayReady = gameStateManager.isPlayButtonReady(downloads[Number(featured?.app_id)]);


  const openGame = (game: CatalogGame) => {
    void narrate(`Game details opened for '${game.name}' (catalog game ${game.id}, Steam AppID ${game.app_id ?? "unknown"}).`, { area: "GAME" });
    setLibraryOpen(false);
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
    // A liked game found in the catalog grid joins the games kept in memory, so Favoritos shows it right away.
    if (next[gameId] === 1 && !games.some(game => game.id === gameId)) {
      void digitalCatalogService.getGamesByCatalogIds([gameId])
        .then(found => { if (found.length) setGames(current => current.some(game => game.id === gameId) ? current : [...current, ...found]); })
        .catch(() => undefined);
    }
    rememberTasteGame(games.find(game => game.id === gameId));
    const done = value === 1 ? (next[gameId] === 1 ? t("toastFavoriteAdded") : t("toastFavoriteRemoved")) : (next[gameId] === -1 ? t("toastFewerLikeThis") : t("toastDislikeRemoved"));
    setToast(`${done} ${tasteProgressText(buildTasteProfile(preferences, games), buildTasteProfile(next, games), personalOrderState().on, t)}`);
  };

  const startDownload = async (game: CatalogGame) => {
    // A Steam game one of the user's accounts owns is installed by Steam (it asks the folder and checks the space).
    const steamEntry = libraryScanState().games.find(entry => entry.app_id === (game.app_id ?? game.id));
    if (isSteamOwned(steamEntry)) {
      try { await installThroughSteam(game); setToast(t("steamInstallHandedOff", { name: game.name })); }
      catch (err) { setToast(err instanceof Error ? err.message : String(err)); }
      return;
    }
    try { await digitalCatalogService.download(game); }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof GameAlreadyInstalledError)) digitalDownloadService.recordFailure(game, message);
      setToast(message);
    }
  };

  const launchGame = async (game: CatalogGame, managedShortcut = false) => {
    // A game being frozen or thawed (or waiting for that) is not started: wait, or cancel that work and play.
    const freezing = freezeJob(game.app_id ?? game.id);
    if (freezing) {
      showNotice({ game: noticeGame(game), title: translate("freezeBlocksPlayTitle", { name: game.name }), text: translate("freezeBlocksPlayText"), tone: "frost", timer: false, actions: [
        { label: translate("freezeWait"), kind: "secondary", run: () => hideNotice() },
        { label: translate("freezeCancelAndPlay"), kind: "frost", run: () => { hideNotice(); cancelFreezeJob(freezing.appId); void freezing.done.then(() => launchGame(game, managedShortcut)); } },
      ] });
      return;
    }
    document.querySelectorAll("video").forEach(video => video.pause());
    setHeroPaused(true); setSelected(null); rememberRecent(game); setLaunchBusy(true);
    // A deep-frozen game is thawed by the launcher before it starts: say so, it can take minutes.
    const deepFrozen = libraryScanState().games.some(entry => entry.app_id === game.app_id && entry.frozen === "deep");
    // A Steam game runs signed in to the account that owns it: Steam may restart to switch accounts.
    const steamOwner = steamOwnerLabel(libraryScanState().games.find(entry => entry.app_id === game.app_id && entry.link_kind === "steam")?.steam_owner);
    // Starting a game can take several steps that can fail (thaw, fix, language, executable): the notice shows them.
    const steps = [...(deepFrozen ? [translate("launchStepThaw")] : []), ...(steamOwner ? [translate("launchStepSteamAccount", { account: steamOwner })] : [translate("launchStepPrepare")]), translate("launchStepStart")];
    const run = runSteps({ game: noticeGame(game), title: translate("launchTitle"), text: steamOwner ? translate("launchSteamDetail") : translate(deepFrozen ? "launchThawing" : "launchDetail"), steps });
    run.set(0, "running");
    // Another game's freeze waits while this one is thawed (if deep frozen) and played: it takes every core and the
    // disk. It goes on when the game ends (or if it does not start). Only for a game whose end can be told (its folder).
    const playedFolder = libraryScanState().games.find(entry => entry.app_id === (game.app_id ?? game.id))?.folder;
    if (playedFolder && hasTauriRuntime()) {
      pauseFreezesWhilePlaying();
      void listen(GAME_ENDED_EVENT, () => resumeFreezes()).then(stop => { gameEndedStop.current?.(); gameEndedStop.current = stop; });
    }
    try {
      if (!managedShortcut && getCatalogMode() === "local" && game.app_id) await openSteamRun(game.app_id);
      else await digitalCatalogService.play(game);
      if (deepFrozen) void scanLibrary();  // it is no longer frozen
      if (game.app_id) recordPlayed(game.app_id);
      // The game gets the focus; when it ends, Game Access comes back with the grid focused.
      watchGameFocus(playedFolder);
      steps.forEach((_, index) => run.set(index, "done"));
      run.succeed({ title: translate("launchPlayingTitle"), text: translate("launchPlayingText", { name: game.name }) });
    } catch (err) {
      resumeFreezes();
      const message = err instanceof Error ? err.message : String(err);
      // Missing files/executable: the install is broken, so offer to fix, delete or reinstall it.
      if (isBrokenInstall(message)) { hideNotice(run.id); setBrokenGame({ game, message }); }
      else run.fail({ title: translate("launchError"), text: message, actions: [
        { label: translate("close"), run: () => hideNotice() },
        { label: translate("retry"), kind: "primary", run: () => void launchGame(game, managedShortcut) },
      ] });
    } finally { setLaunchBusy(false); }
  };

  const shortcutBusy = useRef(false);
  useEffect(() => {
    if (loading || !("__TAURI_INTERNALS__" in window)) return;
    let stopped = false;
    let unlisten: (()=>void) | undefined;
    const consume = async () => {
      if (stopped || shortcutBusy.current || !getActivationTier()) return;
      shortcutBusy.current = true;
      try {
        const appId = await invoke<number | null>("take_launch_request");
        if (typeof appId !== "number") return;
        const game = libraryGames.find(item => (item.app_id ?? item.id) === appId)
          || games.find(item => (item.app_id ?? item.id) === appId);
        if (!game) { setToast(t("toastShortcutGameMissing")); return; }
        await launchGame(game,true);
      } catch (error) { if (!stopped) setToast(error instanceof Error ? error.message : String(error)); }
      finally {shortcutBusy.current=false;}
    };
    void consume();
    void listen("gameaccess:launch-request",()=>void consume()).then(dispose=>{if(stopped)dispose();else unlisten=dispose;});
    const timer = window.setInterval(()=>void consume(),2000);
    return ()=>{stopped=true;window.clearInterval(timer);unlisten?.();};
  },[loading,games,libraryGames]);

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
          <section className="magazine-view" aria-label={t("uiBibliotecaEnVistaRevista")}>
          <div className="hero hero-video magazine-feature" style={featured.hero_image ? { backgroundImage: `url("${featured.hero_image}")` } : undefined}>
            {heroMovie?.mp4 ? <video key={heroMovie.mp4} ref={heroVideoRef} className="hero-video-media" src={heroMovie.mp4} poster={heroMovie.thumbnail} autoPlay={HERO_AUTOPLAY && !heroPaused} muted={heroMuted} playsInline loop /> : null}
            <div className="hero-shade" />
            <div className="hero-copy">
              <span className="hero-kicker">{t("uiTuBiblioteca")}</span>
              <h1>{featured.name}</h1>
              <p>{t("uiSeleccionadoDeTusCuentas")}</p>
              <div className="hero-actions glass-actions-row">
                <GlassActionButton icon={<Play size={24} fill="currentColor" />} label={t("uiJugarAhora")} tone="play" pulse disabled={!featuredPlayReady || launchBusy} onClick={() => void launchGame(featured)} />
                <button type="button" className="secondary-button glass-info-button" onClick={() => openGame(featured)}><Info size={19} /> {t("uiMasInformacion")}</button>
              </div>
            </div>
            <section  className="hero-media-controls" aria-label={t("uiControlesDelBanner")}>
              <button type="button" onClick={previousHero} aria-label={t("uiAnterior")}><ChevronLeft size={19} /></button>
              <button type="button" onClick={toggleHeroPlayback} aria-label={heroPaused ? t("heroPlay") : t("heroPause")}>{heroPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}</button>
              <button type="button" onClick={nextHero} aria-label={t("uiSiguiente")}><ChevronRight size={19} /></button>
              <button type="button" onClick={toggleHeroVolume} aria-label={heroMuted ? t("heroUnmute") : t("heroMute")}>{heroMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            </section>
          </div>
          <section ref={magazineCatalogRef} className="magazine-catalog" aria-label={t("uiJuegosRecientesYFavoritos")}>
            <div className="magazine-heading"><div><span className="eyebrow">{t("uiRecientesYFavoritos")}</span><h2>{t("uiElegiUnJuego")}</h2></div><button type="button" className="sphere-view-button" onClick={() => setLibraryOpen(true)} aria-label={t("uiCambiarAVistaEsfera")}><span /></button></div>
            <div className="magazine-grid" style={{ "--magazine-columns": magazineShape.columns, "--magazine-rows": magazineShape.rows } as React.CSSProperties}>
              {magazineGames.map((game, index) => <div key={game.id} className={index === magazineFocus ? "magazine-item is-focused" : "magazine-item"}><button type="button" className="magazine-card" onFocus={() => setMagazineFocus(index)} onKeyDown={moveMagazineFocus} data-magazine-index={index} onClick={() => openGame(game)} aria-label={t("openGameAria", { name: game.name })}><span className="magazine-card-art">{game.capsule_image ? <img src={game.capsule_image} alt="" loading="lazy" /> : <Gamepad2 size={34} />}</span><span className="magazine-card-title">{game.name}</span></button></div>)}
            </div>
          </section>
          <div className="screen-controls-hint"><span>{t("uiNavegarWasdFlechas")}</span><span>{t("uiDetallesEnter")}</span><span>{t("uiBuscarCtrlF")}</span></div>
          </section>
        ) : null}

        </>);

  return (
    <div className="app-shell">
      {/* The app as the screen of a device: a bezel with tabs and GAME / ACCESS
          sketched in the right column. */}
      {deviceFrameEnabled() ? <DeviceFrame /> : null}
      <header ref={headerRef} className="topbar topbar-glass">
        {catalogNavigation}
        <div className="catalog-header-controls" ref={setToolbarTarget} />
        <div className="topbar-actions ga-header-utilities">
          <AppSettings dockTarget={dockTarget} /><AppHelp dockTarget={dockTarget} /><ParentalSetupDialog />
        </div>
      </header>

      {(() => {
        const downloadsButton = <GaIconButton className="digital-download-nav" icon={<FilledIcon name="download" />} label={t("downloadsTitle")} badge={unfinishedDownloads || undefined} pressed={downloadsOpen} onClick={() => { setSelected(null); togglePanel("downloads"); }} />;
        return dockTarget ? createPortal(downloadsButton, dockTarget) : downloadsButton;
      })()}

      {offlineDemo ? <div className="system-banner demo"><Sparkles size={15} /> {t("offlineBanner")}</div> : null}

      <main>
        <RenderProbe id="LibraryRoom"><LibraryRoom externalDetailGame={selected} onDetailClose={() => setSelected(null)} toolbarTarget={toolbarTarget} actionsTarget={actionsTarget} games={orderedLibrary} downloads={downloads} busy={launchBusy} loading={loading} catalogUnavailable={offlineDemo} onPlay={launchGame} onDownload={startDownload} preferences={preferences} onPreference={setPreference} searchFilters={searchFilters} onSearchFiltersChange={setSearchFilters} searchValue={query} onSearchQueryChange={setQuery} /></RenderProbe>
        {renderMagazine()}
        <div className="content-wrap magazine-secondary">
          {loading ? <div className="loading-home"><Loader2 className="spin" /> {t("uiCargandoBiblioteca")}</div> : null}
          
          {offlineDemo ? (
            <Shelf title={t("uiTuBiblioteca2")} subtitle={t("shelfLibrarySubtitle")} games={orderedLibrary.slice(0, 12)} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} onOpen={openGame} onPreference={setPreference} onViewAll={() => setLibraryOpen(true)} />
          ) : <>
            <Shelf title={t("uiSeguiDondeEstabas")} subtitle={t("shelfContinueSubtitle")} games={continueGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} onOpen={openGame} onPreference={setPreference} />
            <Shelf title={t("uiNuevosLanzamientos")} subtitle={t("shelfNewSubtitle")} games={newGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} onOpen={openGame} onPreference={setPreference} />
            <Shelf title={t("uiTePuedenGustar")} subtitle={t("shelfSuggestedSubtitle")} games={suggestedGames} detailsById={detailsById} machine={machine} downloads={downloads} preferences={preferences} showPreference onOpen={openGame} onPreference={setPreference} />
          </>}
        </div>
      </main>
      <DeskPanel id="news" eyebrow="GAME ACCESS" title={t("newsButton")}><NewsPanel games={games} onOpenGame={game => { if (!isWideDesk()) closePanel("news"); openGame(game); }} /></DeskPanel>
      <DeskPanel id="downloads" eyebrow="DIGITAL" title={t("downloadsTitle")}><DigitalDownloadsScreen embedded service={uiDemo() ? demoService.current : undefined} catalogGames={games} onOpenGame={game => { if (!isWideDesk()) closePanel("downloads"); openGame(game); }} onClose={() => closePanel("downloads")} onPlay={async game => { if (!isWideDesk()) closePanel("downloads"); await launchGame(game); }} /></DeskPanel>

      {libraryOpen ? <LibrarySphere games={orderedLibrary} query={libraryQuery} setQuery={setLibraryQuery} searchFilters={searchFilters} onSearchFiltersChange={setSearchFilters} onOpen={openGame} onClose={() => setLibraryOpen(false)} detailOpen={Boolean(selected)} /> : null}
      {session ? <SessionOverlay session={session} onClose={() => setSession(null)} /> : null}
      <DigitalDownloadErrorDialog />
      {brokenGame ? <GameRecoveryDialog game={brokenGame.game} mode="broken" message={brokenGame.message} onClose={() => setBrokenGame(null)} /> : null}
      <CatalogNewGameNotices notices={catalogUpdates.notices} dismiss={catalogUpdates.dismiss}/>
      {!downloadsOpen && !selected ? <DigitalDownloadToast onOpen={() => { setSelected(null); openPanel("downloads"); }} /> : null}
      <FreezeConsole />
    </div>
  );
}

