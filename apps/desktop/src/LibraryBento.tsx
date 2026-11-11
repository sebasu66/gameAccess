import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import GameInfoCard from "./GameInfoCard";
import { AlertTriangle, ChevronRight, Download, Info, Play, SlidersHorizontal, Snowflake } from "lucide-react";
import { Flip, gsap, motionOk } from "./motion/gsap";
import { useBatchReveal } from "./motion/batchReveal";
import { bigPictureActive, matchesSearch, useBigPicture, useBigPictureView } from "./bigPicture";
import GameSideMenu, { type SideMenuItem } from "./GameSideMenu";
import { gameStateManager } from "./GameStateManager";
import { useI18n } from "./i18n";
import { steamOwnerLabel } from "./steamLibrary";
import { useLibraryScan } from "./libraryScan";
import { libraryMembership } from "./libraryMembership";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import SteamCover from "./SteamCover";
import { GameWideArt } from "./GameArt";
import { downloadManager } from "./downloadManager";
import { bentoInWindow, bentoRowHeight, bentoRowTops, bentoSections, bigPictureBento, bigPictureGroups, featuredGames, nameGroup, type BentoGroupMark, type BentoKind } from "./bentoLayout";
import { coverGap, coverMin, coverTracks } from "./overviewSizing";
import type { DownloadMap } from "./LibraryRoomParts";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";
import "./library-bento.css";

/** Library manager issues that are only notices (an older folder name, no history yet, a backup taking space): the
 *  game works, so its card carries no alert. Every other issue does (game_importer/importer.py, manager.py). */
const NOTICE_ONLY = new Set(["no_status", "no_log", "obsolete_backup"]);
// Row gaps leave room for the game name under each card.
const ROW_GAP = 44;
/** Steam's landscape picture (header.jpg, 460 × 215): games to install show it whole, never cropped or stretched. */
const LANDSCAPE = 215 / 460;
/** The grid counts half columns: a portrait spans two, a game to install three (1.5 times as wide). */
const PORTRAIT_SPAN = 2, WIDE_SPAN = 3;
const gridColumn = (kind: BentoKind, column: number, span = 1) => kind === "pending" ? `${(column - 1) * WIDE_SPAN + 1} / span ${WIDE_SPAN}` : `${(column - 1) * PORTRAIT_SPAN + 1} / span ${PORTRAIT_SPAN * span}`;
/** Which group of the library is shown: all of them, or only one (the three buttons on the filter strip). */
export type LibraryPill = "all" | BentoKind;

interface Props {
  games: CatalogGame[];
  downloads: DownloadMap;
  preferences?: Record<number, 1 | -1>;
  pill: LibraryPill;
  indexes: Map<number, number>;
  selectedId?: number;
  onSelect: (index: number, openDetails?: boolean) => void;
  onContextMenu: (request: { game: CatalogGame; x: number; y: number; status?: ManagedDownloadStatus }) => void;
  onPlay?: (game: CatalogGame) => void | Promise<void>;
  onInstall?: (game: CatalogGame) => void | Promise<void>;
  /** Opens the library manager (advanced actions: freeze, uninstall, remove) on this game. */
  onManage?: (game: CatalogGame) => void;
  /** Where the "ready / not installed" counts show: the right end of the filter strip. */
  infoTarget?: HTMLElement | null;
}

interface Card { /** One card per library folder: the folder (or the game, when it has none yet) tells cards apart. */ key: string; /** A folder whose game is not in the catalogue: it opens the library manager. */ orphan?: boolean; game: CatalogGame; kind: BentoKind; frozen?: LibraryGame["frozen"]; status?: ManagedDownloadStatus; steamOwner?: LibraryGame["steam_owner"]; /** Big picture: a favourite or much played game, shown wide. */ featured?: boolean; plays?: number; lastPlayed?: string; /** What is wrong with its folder (the library manager's issue): the card carries an alert. */ attention?: string }

// The groups are accordions: only the installed games start open. What the player opens or closes is remembered here.
const COLLAPSED_KEY = "gameaccess:library-collapsed";
const DEFAULT_COLLAPSED: BentoKind[] = ["deep", "pending"];
function readCollapsed(): Set<BentoKind> {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "null");
    if (Array.isArray(saved)) return new Set(saved.filter((kind): kind is BentoKind => kind === "ready" || kind === "deep" || kind === "pending"));
  } catch { /* no storage: the default */ }
  return new Set(DEFAULT_COLLAPSED);
}
function saveCollapsed(collapsed: Set<BentoKind>) {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* not remembered, still works */ }
}

const BentoCard = memo(function BentoCard({ card, index, selected, onSelect, onFlip, onManage, onPlay }: { card: Card; index: number; selected: boolean; onSelect: Props["onSelect"]; onFlip: (card: Card, slot: HTMLElement) => void; onManage?: Props["onManage"]; onPlay?: Props["onPlay"] }) {
  const { t } = useI18n();
  const { game, kind, frozen, status } = card;
  const active = gameStateManager.resolve(status).transferActive;
  const progress = active ? downloadManager.progress(status) : 0;
  return (
    <button
      type="button"
      className="ga-bento-card"
      data-kind={kind}
      data-featured={card.featured || undefined}
      data-frozen={frozen || undefined}
      data-library-game-id={game.id}
      aria-current={selected ? "true" : undefined}
      aria-label={`${game.name}${kind === "ready" && !card.attention ? t("cardAriaReady") : ""}${frozen ? ` · ${t(frozen === "deep" ? "bentoDeepFrozen" : "bentoFrozen")}` : ""}${card.attention ? ` · ${t("bentoAttention")}: ${card.attention}` : ""}`}
      onFocus={() => { if (!card.orphan) onSelect(index, false); }}
      // A folder whose game is not in the catalogue has no detail to open: it opens the library manager on it. In big
      // picture a click (or Enter) asks to play it (BigPlayConfirm).
      onClick={() => (card.orphan ? onManage?.(game) : bigPictureActive() ? void onPlay?.(game) : onSelect(index))}
      onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => { event.preventDefault(); const slot = event.currentTarget.closest<HTMLElement>(".ga-bento-slot"); onSelect(index, false); if (slot) onFlip(card, slot); }}
    >
      {card.featured ? <GameWideArt game={game} className="ga-bento-feature" />
        : kind !== "pending" ? <span className="ga-bento-cover"><SteamCover game={game} /></span> : <GameWideArt game={game} className="ga-bento-landscape" />}
      {card.attention ? <span className="ga-bento-alert" title={`${t("bentoAttention")}: ${card.attention}`} aria-hidden="true"><AlertTriangle size={15} /></span> : null}
      {frozen && kind !== "deep" ? <span className="ga-bento-frost" title={t("bentoFrozen")} aria-hidden="true"><Snowflake size={15} /></span> : null}
      {kind === "deep" ? <span className="ga-bento-ice" aria-hidden="true"><Snowflake size={20} /><span>{t("bentoIce")}</span></span> : null}
      <span className="ga-bento-name"><span>{game.name}</span>{kind === "pending" ? <Download size={15} aria-hidden="true" /> : kind === "deep" ? <Snowflake size={15} aria-hidden="true" /> : null}</span>
      {active ? <span className="ga-bento-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress / 100})` }} /></span> : null}
    </button>
  );
});

const DWELL_MS = 1000;

/**
 * The short menu of a library card (docs/TAREA-interfaz-nueva.md T8), in the glass side panel shared with the
 * catalog: Play or Install, Manage and Details. Everything else (rename, freeze, uninstall) lives in the library manager.
 */
function SideMenu({ card, slot, onClose, onPlay, onInstall, onDetails, onManage }: { card: Card; slot: HTMLElement; onClose: () => void; onPlay?: Props["onPlay"]; onInstall?: Props["onInstall"]; onDetails: (game: CatalogGame) => void; onManage?: Props["onManage"] }) {
  const { t } = useI18n();
  const deep = card.kind === "deep";
  const items: SideMenuItem[] = [
    card.kind === "pending"
      ? { key: "install", primary: true, label: t(card.steamOwner ? "steamInstallMenu" : "flipInstall"), icon: <Download size={15} aria-hidden="true" />, run: () => void onInstall?.(card.game) }
      : { key: "play", primary: true, disabled: deep, title: deep ? t("flipFrozenHint") : undefined, label: t("flipPlay"), icon: <Play size={15} fill="currentColor" aria-hidden="true" />, run: () => void onPlay?.(card.game) },
    { key: "manage", label: t("flipManage"), icon: <SlidersHorizontal size={15} aria-hidden="true" />, run: () => onManage?.(card.game) },
    { key: "details", label: t("infoMenu"), icon: <Info size={15} aria-hidden="true" />, run: () => onDetails(card.game) },
  ];
  const owner = steamOwnerLabel(card.steamOwner);
  return <GameSideMenu anchor={slot} label={t("flipMenuLabel", { name: card.game.name })} items={items} note={owner ? t("steamOwnerNote", { account: owner }) : undefined} onClose={onClose} />;
}

/** Three lines that draw themselves after the pointer rests 1 s on a card, then pulse; a click opens the side menu. */
function MenuDot({ shown, label, onOpen }: { shown: boolean; label: string; onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className="ga-bento-menu" data-shown={shown || undefined} aria-label={label} title={label} onClick={event => { event.stopPropagation(); onOpen(event); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h14" /></svg>
    </button>
  );
}

/**
 * The library as a bento grid (docs/TAREA-interfaz-nueva.md T7): installed games in portrait, games to install in
 * small landscape, deep-frozen ones grouped on the right with an ice veil. Removed games shrink in their place before
 * the rest move with Flip; a finished download grows from landscape to portrait.
 */
export default function LibraryBento({ games, downloads, preferences = {}, pill, indexes, selectedId, onSelect, onPlay, onInstall, onManage, infoTarget }: Props) {
  const { t } = useI18n();
  const scan = useLibraryScan();
  // Big picture mode: only the games ready to play, and no card menu (a controller picks a game and plays it).
  const bigPicture = useBigPicture();
  // Its order (last played, by letter, by genre) and its search (bigPicture.ts).
  const bigView = useBigPictureView();
  const query = bigPicture ? bigView.query : "";
  // The menu dot appears after resting 1 s on a card (or at once with the keyboard); a click turns the card over.
  const [dotFor, setDotFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<{ card: Card; slot: HTMLElement } | null>(null);
  const [details, setDetails] = useState<CatalogGame | null>(null);
  const dwell = useRef(0);
  // A right click on another card closes the open menu and opens that card's at once; on the same card it stays.
  const openMenu = useCallback((card: Card, slot: HTMLElement) => { if (!bigPictureActive()) setMenuFor(current => (current?.card.key === card.key ? current : { card, slot })); }, []);
  const rest = (key: string) => { window.clearTimeout(dwell.current); dwell.current = window.setTimeout(() => setDotFor(key), DWELL_MS); };
  const leave = (key: string) => { window.clearTimeout(dwell.current); if (menuFor?.card.key !== key) setDotFor(current => (current === key ? null : current)); };
  useEffect(() => () => window.clearTimeout(dwell.current), []);
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [rowHeight, setRowHeight] = useState(84);
  const [wideHeight, setWideHeight] = useState(90);
  const [columnGap, setColumnGap] = useState(28);

  const cards = useMemo<Card[]>(() => {
    // The library manager's rows grouped by game: a game in two folders has two rows, and gets two cards.
    const folders = new Map<number | null, LibraryGame[]>();
    for (const entry of scan.games) if (entry.folder && entry.state !== "steam_owned") folders.set(entry.app_id, [...(folders.get(entry.app_id) ?? []), entry]);
    const card = (game: CatalogGame, entry: LibraryGame | undefined, key: string, twice: number, orphan = false): Card[] => {
      const status = (game.app_id ? downloads[game.app_id] : undefined) ?? downloads[game.id];
      const state = gameStateManager.resolve(status);
      // A folder with a problem the library manager reports (misnamed, a failed install...) shows here too, with an
      // alert, so the library and the manager agree. A folder installed by hand counts as installed.
      const problem = entry?.folder && !entry.unfinished ? entry.issues?.find(issue => !NOTICE_ONLY.has(issue.code)) : undefined;
      const blocked = problem?.message ?? (twice > 1 ? t("bentoTwice", { count: twice, folder: entry?.folder ?? "" }) : undefined);
      // A game that was tried here and did not open (the library manager's verdict) shows the alert with the reason too.
      const cantRun = entry?.run_check?.state === "cantRun" ? t("bentoCantRun", { why: entry.run_check.detail }) : undefined;
      const attention = blocked ?? cantRun;
      const installed = !orphan && (state.installed || state.prepared || Boolean(entry?.installed) || Boolean(entry?.misnamed));
      const kind: BentoKind = installed ? (entry?.frozen === "deep" ? "deep" : "ready") : orphan ? "ready" : "pending";
      // Big picture shows only what can be played.
      if (bigPicture ? kind !== "ready" || blocked : pill !== "all" && kind !== pill) return [];
      return [{ key, orphan, game, kind, frozen: installed ? entry?.frozen : undefined, status, steamOwner: entry?.link_kind === "steam" ? entry.steam_owner : undefined, plays: entry?.plays, lastPlayed: entry?.last_played, attention }];
    };
    const list: Card[] = games.flatMap(game => {
      const rows = game.app_id ? folders.get(game.app_id) ?? [] : [];
      if (rows.length < 2) return card(game, rows[0], String(game.id), 1);
      return rows.flatMap(entry => card(game, entry, `${game.id}:${entry.folder}`, rows.length));
    });
    // Folders the manager lists whose game is not in the library (an unknown or invented AppID, or none) and that have
    // a problem: they show too, by their folder's name, so nothing the manager flags is missing here.
    if (!bigPicture) {
      const known = new Set(libraryMembership.getGames().map(game => game.app_id ?? game.id));
      for (const [appId, rows] of folders) {
        if (appId !== null && known.has(appId)) continue;
        for (const entry of rows) {
          // A download still going (or stopped) belongs to the downloads panel, not here.
          if (entry.unfinished || !entry.issues?.some(issue => !NOTICE_ONLY.has(issue.code))) continue;
          const id = appId ?? -Math.abs([...entry.folder].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7));
          const game = { id, app_id: appId, slug: `folder-${id}`, name: entry.name || entry.folder, genres: [], categories: [], tags: [], copies_total: 0, copies_available: 0, credit_cost_per_hour: 0 } as unknown as CatalogGame;
          list.push(...card(game, entry, `folder:${entry.folder}`, rows.length, true));
        }
      }
    }
    if (!bigPicture) return list;
    // Big picture: the games played most recently are shown wide (bentoLayout.featuredGames).
    const featured = featuredGames(list, card => ({ liked: preferences[card.game.id] === 1, plays: card.plays ?? 0, lastPlayed: Date.parse(card.lastPlayed ?? "") || 0 }));
    return list.map(card => (featured.has(card) ? { ...card, featured: true } : card));
  }, [games, downloads, scan.games, pill, preferences, bigPicture, t]);

  // Columns and row height follow the grid width: three rows are as tall as one portrait; a game to install spans one
  // and a half portrait columns and its row is exactly as tall as its picture.
  useLayoutEffect(() => {
    const host = grid.current;
    if (!host) return;
    const measure = () => {
      const width = host.clientWidth;
      // The same rule as the catalog: smaller covers on small windows (180 px on big ones).
      const gap = coverGap(window.innerWidth) + 4;
      const cols = coverTracks(width, gap, coverMin(window.innerWidth, window.innerHeight, 180));
      const columnWidth = (width - gap * (cols - 1)) / cols;
      const half = (width - gap * (cols * PORTRAIT_SPAN - 1)) / (cols * PORTRAIT_SPAN);
      setColumns(cols);
      setColumnGap(gap);
      setRowHeight(bentoRowHeight(columnWidth, ROW_GAP));
      setWideHeight(Math.round((half * WIDE_SPAN + gap * (WIDE_SPAN - 1)) * LANDSCAPE));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(host);
    // The cover size also follows the window's height, which the grid's own size does not report.
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const found = useMemo(() => (query ? cards.filter(card => matchesSearch(card.game.name, query)) : cards), [cards, query]);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Big picture mode, or a group picked with its button, shows that one group open, whatever the player closed.
  const order = bigView.order;
  const noGenre = t("bigPictureNoGenre");
  const layout = useMemo(() => {
    if (bigPicture) {
      const byName = (a: Card, b: Card) => a.game.name.localeCompare(b.game.name, undefined, { sensitivity: "base", numeric: true });
      const played = (card: Card) => Date.parse(card.lastPlayed ?? "") || 0;
      // Last played first (the never played ones after them, by name); the most recent ones wide (bigPictureBento).
      if (order === "recent") {
        const sorted = [...found].sort((a, b) => played(b) - played(a) || byName(a, b));
        const wide = bigPictureBento(sorted.filter(card => card.featured), sorted.filter(card => !card.featured), columns);
        // A featured game the lines had no room for as wide goes back to its portrait cover.
        const placements = wide.placements.map(item => ((item.span ?? 1) < 2 && item.value.featured ? { ...item, value: { ...item.value, featured: false } } : item));
        const { tracks } = wide;
        const marks: BentoGroupMark[] = sorted.length ? [{ title: t("bigPictureOrderRecent"), row: 1, count: sorted.length }] : [];
        return { placements, tracks, sections: [], marks };
      }
      // By letter ("#" first) or by genre (its first genre, so a game shows once; the ones without a genre last).
      const groups = new Map<string, Card[]>();
      // Grouped, every game is a portrait: the wide ones belong to "last played".
      for (const card of found.map(item => (item.featured ? { ...item, featured: false } : item)).sort(byName)) {
        const title = order === "name" ? nameGroup(card.game.name) : card.game.genres?.find(Boolean) ?? noGenre;
        groups.set(title, [...(groups.get(title) ?? []), card]);
      }
      const rank = (title: string) => (order === "name" ? (title === "#" ? 0 : 1) : title === noGenre ? 1 : 0);
      const list = [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([title, values]) => ({ title, values }));
      return { ...bigPictureGroups(list, columns), sections: [] };
    }
    return { ...bentoSections(cards.map(card => ({ kind: card.kind, value: card })), columns, pill !== "all" ? new Set<BentoKind>() : collapsed, Math.floor(columns * PORTRAIT_SPAN / WIDE_SPAN)), marks: [] as BentoGroupMark[] };
  }, [cards, found, order, noGenre, columns, collapsed, bigPicture, pill, t]);
  useEffect(() => { if (bigPicture) setMenuFor(null); }, [bigPicture]);
  const placed = layout.placements;
  const sectionNames: Record<BentoKind, string> = { ready: t("bentoSectionReady"), deep: t("bentoSectionDeep"), pending: t("bentoSectionPending") };

  // Sliding window: only the cards on screen plus one card row above and below are mounted; the grid keeps every row,
  // so its height and the scrollbar never depend on what is mounted. A scroll renders only when the window changes.
  const tops = useMemo(() => bentoRowTops(layout.tracks, rowHeight, ROW_GAP, wideHeight), [layout.tracks, rowHeight, wideHeight]);
  const [band, setBand] = useState<{ from: number; to: number } | null>(null);
  const bandInputs = useRef({ tops, rowHeight, wideHeight, placed });
  bandInputs.current = { tops, rowHeight, wideHeight, placed };
  const refreshBand = useRef(() => {});
  useLayoutEffect(() => {
    const host = grid.current;
    const root = host?.closest<HTMLElement>(".library-section-scroll");
    if (!host || !root) return;
    let offset = 0, frame = 0, lastKey = "";
    const update = () => {
      frame = 0;
      const { tops, rowHeight, wideHeight, placed } = bandInputs.current;
      const margin = rowHeight * 3 + ROW_GAP * 3;
      const from = root.scrollTop - offset - margin, to = root.scrollTop - offset + root.clientHeight + margin;
      const key = bentoInWindow(placed, tops, rowHeight, from, to, wideHeight).map(item => item.value.key).join(",");
      if (key !== lastKey) { lastKey = key; setBand({ from, to }); }
    };
    const measure = () => {
      offset = host.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      lastKey = "";
      update();
    };
    const scroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    refreshBand.current = () => { lastKey = ""; update(); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    observer?.observe(host);
    root.addEventListener("scroll", scroll, { passive: true });
    return () => { observer?.disconnect(); root.removeEventListener("scroll", scroll); window.cancelAnimationFrame(frame); };
  }, [tops]);
  // The selected card and the one with the menu open stay mounted (keyboard focus, the menu's anchor).
  const shown = useMemo(() => {
    if (!band) return placed.slice(0, columns * 2);
    const inside = new Set(bentoInWindow(placed, tops, rowHeight, band.from, band.to, wideHeight));
    return placed.filter(item => inside.has(item) || item.value.game.id === selectedId || item.value.key === menuFor?.card.key);
  }, [placed, tops, rowHeight, wideHeight, band, columns, selectedId, menuFor]);
  // Cards reveal themselves in batches as they scroll into view (GSAP's official ScrollTrigger.batch demo).
  useBatchReveal(grid, ".ga-bento-slot:not([data-leaving])", shown, tops);

  // Flip only when the set of cards really changes (one added, removed or moved to another group): never when the
  // library appears (it would fight the 3D turn), on resize, on a download's progress or when a group opens or closes.
  // Measuring every card forces a layout, so it happens once per real change, not on every render.
  const flipKey = useMemo(() => placed.map(item => `${item.value.key}:${item.kind}`).join(","), [placed]);
  const lastKey = useRef<string | null>(null);
  const quiet = useRef(true);
  const [leaving, setLeaving] = useState<Array<{ card: Card; style: CSSProperties }>>([]);
  const lastPlaced = useRef(placed);
  const flipState = useRef<Flip.FlipState | null>(null);
  if (grid.current && lastKey.current !== null && flipKey !== lastKey.current && !quiet.current && !flipState.current && motionOk()) {
    flipState.current = Flip.getState(grid.current.querySelectorAll(".ga-bento-slot:not([data-leaving]) > .ga-bento-card"));
  }
  useLayoutEffect(() => {
    const still = quiet.current || lastKey.current === null;
    quiet.current = false;
    lastKey.current = flipKey;
    const state = flipState.current;
    flipState.current = null;
    if (still || !grid.current || !motionOk()) return;
    // Leaving cards stay one moment to shrink in place; then the rest move to their new slots.
    const now = new Set(placed.map(item => item.value.key));
    const gone = lastPlaced.current.filter(item => !now.has(item.value.key));
    if (gone.length) setLeaving(gone.map(item => ({ card: item.value, style: { gridColumn: gridColumn(item.kind, item.column, item.span), gridRow: `${item.row} / span ${item.rowSpan}` } })));
    if (state) Flip.from(state, { targets: grid.current.querySelectorAll(".ga-bento-slot:not([data-leaving]) > .ga-bento-card"), duration: .6, ease: "expo.inOut", absolute: true, delay: gone.length ? .25 : 0,
      onEnter: elements => gsap.fromTo(elements, { opacity: 0, scale: .85 }, { opacity: 1, scale: 1, duration: .45, ease: "power3.out" }) });
  }, [flipKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { lastPlaced.current = placed; }, [placed]);
  useLayoutEffect(() => refreshBand.current(), [flipKey]);
  const toggleGroup = (kind: BentoKind) => {
    quiet.current = true;  // opening or closing shows or hides the cards at once
    setCollapsed(current => {
      const next = new Set(current);
      if (!next.delete(kind)) next.add(kind);
      saveCollapsed(next);
      return next;
    });
  };
  useEffect(() => {
    if (!leaving.length || !grid.current) return;
    const nodes = grid.current.querySelectorAll("[data-leaving]");
    const tween = gsap.to(nodes, { scale: .5, opacity: 0, duration: .3, ease: "power2.in", onComplete: () => setLeaving([]) });
    return () => { tween.kill(); };
  }, [leaving]);

  const counts = {
    ready: cards.filter(card => card.kind === "ready").length,
    pending: cards.filter(card => card.kind === "pending").length,
    deep: cards.filter(card => card.kind === "deep").length,
  };
  // The counts live in the filter strip above (a section title would repeat the side label).
  const summary = <span className="ga-strip-count">{t("bentoCounts", { ready: counts.ready, pending: counts.pending })}{counts.deep ? t("bentoCountsDeep", { deep: counts.deep }) : ""}</span>;
  return (
    <div className="ga-bento-wrap">
      {infoTarget ? createPortal(summary, infoTarget) : null}
      <div ref={grid} className="ga-bento" style={{ "--ga-bento-row": `${rowHeight}px`, "--ga-bento-columns": columns * PORTRAIT_SPAN, "--ga-bento-wide": `${wideHeight}px`, "--ga-bento-gap": `${columnGap}px`, gridTemplateRows: layout.tracks.map(track => (track === "label" ? "0px" : track === "wide" ? "var(--ga-bento-wide)" : "var(--ga-bento-row)")).join(" ") } as CSSProperties}>
        {layout.sections.map(section => (
          <div key={`section-${section.kind}`} className="ga-bento-divider" data-collapsed={section.collapsed || undefined} style={{ gridColumn: "1 / -1", gridRow: section.row }}>
            <button type="button" aria-expanded={!section.collapsed} onClick={() => toggleGroup(section.kind)}>
              <ChevronRight size={14} aria-hidden="true" /><span>{sectionNames[section.kind]}</span><span className="ga-bento-divider-count">({section.count})</span>
            </button>
          </div>
        ))}
        {/* Big picture's group titles: they only name, nothing to open or close. */}
        {layout.marks.map(mark => (
          <div key={`mark-${mark.title}`} className="ga-bento-divider ga-big-group-title" style={{ gridColumn: "1 / -1", gridRow: mark.row }}>
            <span>{mark.title}</span><span className="ga-bento-divider-count">({mark.count})</span>
          </div>
        ))}
        {shown.map(item => (
          <div key={item.value.key} className="ga-bento-slot" style={{ gridColumn: gridColumn(item.kind, item.column, item.span), gridRow: `${item.row} / span ${item.rowSpan}`}}
            onPointerEnter={() => rest(item.value.key)} onPointerLeave={() => leave(item.value.key)} onFocus={() => setDotFor(item.value.key)}>
            <BentoCard card={item.value} index={indexes.get(item.value.game.id) ?? 0} selected={item.value.game.id === selectedId} onSelect={onSelect} onFlip={openMenu} onManage={onManage} onPlay={onPlay} />
            <MenuDot shown={dotFor === item.value.key && !menuFor} label={t("flipMenuLabel", { name: item.value.game.name })}
              onOpen={event => { const slot = (event.currentTarget as HTMLElement).closest<HTMLElement>(".ga-bento-slot"); if (slot) openMenu(item.value, slot); }} />
          </div>
        ))}
        {leaving.map(({ card, style }) => (
          <div key={`leaving-${card.key}`} className="ga-bento-slot" style={style} data-leaving="true" aria-hidden="true">
            <div className="ga-bento-card" data-kind={card.kind}>{card.kind !== "pending" ? <span className="ga-bento-cover"><SteamCover game={card.game} /></span> : <GameWideArt game={card.game} className="ga-bento-landscape" lazy={false} />}</div>
          </div>
        ))}
      </div>
      {!found.length ? <p className="ga-bento-empty">{cards.length ? t("bigPictureNoMatch", { query }) : t("bentoEmpty")}</p> : null}
      {menuFor ? <SideMenu key={menuFor.card.key} card={menuFor.card} slot={menuFor.slot} onPlay={onPlay} onInstall={onInstall} onManage={onManage} onDetails={setDetails}
        onClose={() => { setMenuFor(null); setDotFor(null); }} /> : null}
      {details ? <GameInfoCard game={details} onClose={() => setDetails(null)} /> : null}
    </div>
  );
}
