import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import RenameGameDialog from "./RenameGameDialog";
import { ChevronRight, Download, Pencil, Play, SlidersHorizontal, Snowflake } from "lucide-react";
import { Flip, gsap, motionOk } from "./motion/gsap";
import { useBatchReveal } from "./motion/batchReveal";
import { bigPictureActive, useBigPicture } from "./bigPicture";
import GameSideMenu, { type SideMenuItem } from "./GameSideMenu";
import { gameStateManager } from "./GameStateManager";
import { useI18n } from "./i18n";
import { steamOwnerLabel } from "./steamLibrary";
import { useLibraryScan } from "./libraryScan";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import SteamCover from "./SteamCover";
import { downloadManager } from "./downloadManager";
import { bentoInWindow, bentoRowHeight, bentoRowTops, bentoSections, type BentoKind } from "./bentoLayout";
import { coverGap, coverMin, coverTracks } from "./overviewSizing";
import type { DownloadMap } from "./LibraryRoomParts";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";
import "./library-bento.css";

// Row gaps leave room for the game name under each card.
const ROW_GAP = 44;
const landscape = (game: CatalogGame) => game.app_id ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/header.jpg` : game.header_image ?? game.capsule_image ?? "";
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

interface Card { game: CatalogGame; kind: BentoKind; frozen?: LibraryGame["frozen"]; status?: ManagedDownloadStatus; steamOwner?: LibraryGame["steam_owner"] }

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

const BentoCard = memo(function BentoCard({ card, index, selected, onSelect, onFlip }: { card: Card; index: number; selected: boolean; onSelect: Props["onSelect"]; onFlip: (card: Card, slot: HTMLElement) => void }) {
  const { t } = useI18n();
  const { game, kind, frozen, status } = card;
  const active = gameStateManager.resolve(status).transferActive;
  const progress = active ? downloadManager.progress(status) : 0;
  return (
    <button
      type="button"
      className="ga-bento-card"
      data-kind={kind}
      data-frozen={frozen || undefined}
      data-library-game-id={game.id}
      aria-current={selected ? "true" : undefined}
      aria-label={`${game.name}${kind === "ready" ? t("cardAriaReady") : ""}${frozen ? ` · ${t(frozen === "deep" ? "bentoDeepFrozen" : "bentoFrozen")}` : ""}`}
      onFocus={() => onSelect(index, false)}
      onClick={() => onSelect(index)}
      onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => { event.preventDefault(); const slot = event.currentTarget.closest<HTMLElement>(".ga-bento-slot"); onSelect(index, false); if (slot) onFlip(card, slot); }}
    >
      {kind !== "pending" ? <span className="ga-bento-cover"><SteamCover game={game} /></span> : <img className="ga-bento-landscape" src={landscape(game)} alt="" loading="lazy" />}
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
 * catalog: Play or Install, Rename and Manage. Advanced actions (freeze, uninstall, remove) live in the library manager.
 */
function SideMenu({ card, slot, onClose, onPlay, onInstall, onRename, onManage }: { card: Card; slot: HTMLElement; onClose: () => void; onPlay?: Props["onPlay"]; onInstall?: Props["onInstall"]; onRename: (game: CatalogGame) => void; onManage?: Props["onManage"] }) {
  const { t } = useI18n();
  const deep = card.kind === "deep";
  const items: SideMenuItem[] = [
    card.kind === "pending"
      ? { key: "install", primary: true, label: t(card.steamOwner ? "steamInstallMenu" : "flipInstall"), icon: <Download size={15} aria-hidden="true" />, run: () => void onInstall?.(card.game) }
      : { key: "play", primary: true, disabled: deep, title: deep ? t("flipFrozenHint") : undefined, label: t("flipPlay"), icon: <Play size={15} fill="currentColor" aria-hidden="true" />, run: () => void onPlay?.(card.game) },
    { key: "rename", label: t("renameMenu"), icon: <Pencil size={15} aria-hidden="true" />, run: () => onRename(card.game) },
    { key: "manage", label: t("flipManage"), icon: <SlidersHorizontal size={15} aria-hidden="true" />, run: () => onManage?.(card.game) },
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
  // The menu dot appears after resting 1 s on a card (or at once with the keyboard); a click turns the card over.
  const [dotFor, setDotFor] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<{ card: Card; slot: HTMLElement } | null>(null);
  const [renaming, setRenaming] = useState<CatalogGame | null>(null);
  const dwell = useRef(0);
  const openMenu = useCallback((card: Card, slot: HTMLElement) => { if (!bigPictureActive()) setMenuFor(current => current ?? { card, slot }); }, []);
  const rest = (id: number) => { window.clearTimeout(dwell.current); dwell.current = window.setTimeout(() => setDotFor(id), DWELL_MS); };
  const leave = (id: number) => { window.clearTimeout(dwell.current); if (menuFor?.card.game.id !== id) setDotFor(current => (current === id ? null : current)); };
  useEffect(() => () => window.clearTimeout(dwell.current), []);
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [rowHeight, setRowHeight] = useState(84);
  const [columnGap, setColumnGap] = useState(28);

  const cards = useMemo<Card[]>(() => {
    const entries = new Map(scan.games.map(entry => [entry.app_id, entry]));
    return games.flatMap(game => {
      const status = (game.app_id ? downloads[game.app_id] : undefined) ?? downloads[game.id];
      const state = gameStateManager.resolve(status);
      const entry = game.app_id ? entries.get(game.app_id) : undefined;
      const installed = state.installed || state.prepared || Boolean(entry?.installed);
      const kind: BentoKind = installed ? (entry?.frozen === "deep" ? "deep" : "ready") : "pending";
      if (bigPicture ? kind !== "ready" : pill !== "all" && kind !== pill) return [];
      return [{ game, kind, frozen: installed ? entry?.frozen : undefined, status, steamOwner: entry?.link_kind === "steam" ? entry.steam_owner : undefined }];
    });
  }, [games, downloads, scan.games, pill, preferences, bigPicture]);

  // Columns and row height follow the grid width: three landscape rows are as tall as one portrait.
  useLayoutEffect(() => {
    const host = grid.current;
    if (!host) return;
    const measure = () => {
      const width = host.clientWidth;
      // The same rule as the catalog: smaller covers on small windows (180 px on big ones).
      const gap = coverGap(window.innerWidth) + 4;
      const cols = coverTracks(width, gap, coverMin(window.innerWidth, window.innerHeight, 180));
      const columnWidth = (width - gap * (cols - 1)) / cols;
      setColumns(cols);
      setColumnGap(gap);
      setRowHeight(bentoRowHeight(columnWidth, ROW_GAP));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(host);
    // The cover size also follows the window's height, which the grid's own size does not report.
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Big picture mode, or a group picked with its button, shows that one group open, whatever the player closed.
  const layout = useMemo(() => bentoSections(cards.map(card => ({ kind: card.kind, value: card })), columns, bigPicture || pill !== "all" ? new Set<BentoKind>() : collapsed), [cards, columns, collapsed, bigPicture, pill]);
  useEffect(() => { if (bigPicture) setMenuFor(null); }, [bigPicture]);
  const placed = layout.placements;
  const sectionNames: Record<BentoKind, string> = { ready: t("bentoSectionReady"), deep: t("bentoSectionDeep"), pending: t("bentoSectionPending") };

  // Sliding window: only the cards on screen plus one card row above and below are mounted; the grid keeps every row,
  // so its height and the scrollbar never depend on what is mounted. A scroll renders only when the window changes.
  const tops = useMemo(() => bentoRowTops(layout.tracks, rowHeight, ROW_GAP), [layout.tracks, rowHeight]);
  const [band, setBand] = useState<{ from: number; to: number } | null>(null);
  const bandInputs = useRef({ tops, rowHeight, placed });
  bandInputs.current = { tops, rowHeight, placed };
  const refreshBand = useRef(() => {});
  useLayoutEffect(() => {
    const host = grid.current;
    const root = host?.closest<HTMLElement>(".library-section-scroll");
    if (!host || !root) return;
    let offset = 0, frame = 0, lastKey = "";
    const update = () => {
      frame = 0;
      const { tops, rowHeight, placed } = bandInputs.current;
      const margin = rowHeight * 3 + ROW_GAP * 3;
      const from = root.scrollTop - offset - margin, to = root.scrollTop - offset + root.clientHeight + margin;
      const key = bentoInWindow(placed, tops, rowHeight, from, to).map(item => item.value.game.id).join(",");
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
    const inside = new Set(bentoInWindow(placed, tops, rowHeight, band.from, band.to));
    return placed.filter(item => inside.has(item) || item.value.game.id === selectedId || item.value.game.id === menuFor?.card.game.id);
  }, [placed, tops, rowHeight, band, columns, selectedId, menuFor]);
  // Cards reveal themselves in batches as they scroll into view (GSAP's official ScrollTrigger.batch demo).
  useBatchReveal(grid, ".ga-bento-slot:not([data-leaving])", shown, tops);

  // Flip only when the set of cards really changes (one added, removed or moved to another group): never when the
  // library appears (it would fight the 3D turn), on resize, on a download's progress or when a group opens or closes.
  // Measuring every card forces a layout, so it happens once per real change, not on every render.
  const flipKey = useMemo(() => placed.map(item => `${item.value.game.id}:${item.kind}`).join(","), [placed]);
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
    const now = new Set(placed.map(item => item.value.game.id));
    const gone = lastPlaced.current.filter(item => !now.has(item.value.game.id));
    if (gone.length) setLeaving(gone.map(item => ({ card: item.value, style: { gridColumn: item.column, gridRow: `${item.row} / span ${item.rowSpan}` } })));
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
      <div ref={grid} className="ga-bento" style={{ "--ga-bento-row": `${rowHeight}px`, "--ga-bento-columns": columns, "--ga-bento-gap": `${columnGap}px`, gridTemplateRows: layout.tracks.map(track => (track === "label" ? "0px" : "var(--ga-bento-row)")).join(" ") } as CSSProperties}>
        {layout.sections.map(section => (
          <div key={`section-${section.kind}`} className="ga-bento-divider" data-collapsed={section.collapsed || undefined} style={{ gridColumn: "1 / -1", gridRow: section.row }}>
            <button type="button" aria-expanded={!section.collapsed} onClick={() => toggleGroup(section.kind)}>
              <ChevronRight size={14} aria-hidden="true" /><span>{sectionNames[section.kind]}</span><span className="ga-bento-divider-count">({section.count})</span>
            </button>
          </div>
        ))}
        {shown.map(item => (
          <div key={item.value.game.id} className="ga-bento-slot" style={{ gridColumn: item.column, gridRow: `${item.row} / span ${item.rowSpan}`}}
            onPointerEnter={() => rest(item.value.game.id)} onPointerLeave={() => leave(item.value.game.id)} onFocus={() => setDotFor(item.value.game.id)}>
            <BentoCard card={item.value} index={indexes.get(item.value.game.id) ?? 0} selected={item.value.game.id === selectedId} onSelect={onSelect} onFlip={openMenu} />
            <MenuDot shown={dotFor === item.value.game.id && !menuFor} label={t("flipMenuLabel", { name: item.value.game.name })}
              onOpen={event => { const slot = (event.currentTarget as HTMLElement).closest<HTMLElement>(".ga-bento-slot"); if (slot) openMenu(item.value, slot); }} />
          </div>
        ))}
        {leaving.map(({ card, style }) => (
          <div key={`leaving-${card.game.id}`} className="ga-bento-slot" style={style} data-leaving="true" aria-hidden="true">
            <div className="ga-bento-card" data-kind={card.kind}>{card.kind !== "pending" ? <span className="ga-bento-cover"><SteamCover game={card.game} /></span> : <img className="ga-bento-landscape" src={landscape(card.game)} alt="" />}</div>
          </div>
        ))}
      </div>
      {!cards.length ? <p className="ga-bento-empty">{t("bentoEmpty")}</p> : null}
      {menuFor ? <SideMenu card={menuFor.card} slot={menuFor.slot} onPlay={onPlay} onInstall={onInstall} onManage={onManage} onRename={setRenaming}
        onClose={() => { setMenuFor(null); setDotFor(null); }} /> : null}
      {renaming ? <RenameGameDialog game={renaming} current={scan.games.find(entry => entry.app_id === renaming.app_id)?.label ?? ""} onClose={() => setRenaming(null)} /> : null}
    </div>
  );
}
