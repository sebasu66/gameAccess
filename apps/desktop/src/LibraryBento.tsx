import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import RenameGameDialog from "./RenameGameDialog";
import { ChevronRight, Download, Pencil, Play, SlidersHorizontal, Snowflake } from "lucide-react";
import { Flip, gsap, motionOk } from "./motion/gsap";
import { gameStateManager } from "./GameStateManager";
import { useI18n } from "./i18n";
import { useLibraryScan } from "./libraryScan";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import SteamCover from "./SteamCover";
import { downloadManager } from "./downloadManager";
import { bentoInWindow, bentoRowHeight, bentoRowTops, bentoSections, type BentoKind } from "./bentoLayout";
import type { DownloadMap } from "./LibraryRoomParts";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";
import "./library-bento.css";

// Row gaps leave room for the game name under each card.
const COLUMN_GAP = 28;
const ROW_GAP = 44;
const landscape = (game: CatalogGame) => game.app_id ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/header.jpg` : game.header_image ?? game.capsule_image ?? "";
export type LibraryPill = "all" | "installed" | "favorites";

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

interface Card { game: CatalogGame; kind: BentoKind; frozen?: LibraryGame["frozen"]; status?: ManagedDownloadStatus }

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
      {kind === "ready" ? <span className="ga-card-installed ga-bento-play" aria-hidden="true"><Play size={12} fill="currentColor" /></span> : null}
      {frozen && kind !== "deep" ? <span className="ga-bento-frost" title={t("bentoFrozen")} aria-hidden="true"><Snowflake size={15} /></span> : null}
      {kind === "deep" ? <span className="ga-bento-ice" aria-hidden="true"><Snowflake size={20} /><span>{t("bentoIce")}</span></span> : null}
      <span className="ga-bento-name"><span>{game.name}</span>{kind === "pending" ? <Download size={15} aria-hidden="true" /> : kind === "deep" ? <Snowflake size={15} aria-hidden="true" /> : null}</span>
      {active ? <span className="ga-bento-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress / 100})` }} /></span> : null}
    </button>
  );
});

// Cards come in one by one as they enter the window: each column a little later, landscape stacks top to bottom.
const revealDelay = (item: { column: number; row: number; kind: BentoKind }) => (item.column - 1) * 55 + (item.kind === "pending" ? ((item.row - 1) % 3) * 35 : 0);

const DWELL_MS = 1000;
// The menu stays while the pointer is within this many pixels of the card or the menu, and closes a moment after it leaves.
const LEAVE_MS = 450;
const LEAVE_MARGIN = 70;

/**
 * The short menu of a library card (docs/TAREA-interfaz-nueva.md T8): a glass panel that opens beside the card, like
 * an augmented-reality label. Its edge against the card is solid and the glass fades away toward the other sides;
 * the menu has Play or Install, Rename and Manage. Advanced actions (freeze, uninstall, remove) live in the library
 * manager. It closes when the pointer moves away, with Escape or on scroll.
 */
function SideMenu({ card, slot, onClose, onPlay, onInstall, onRename, onManage }: { card: Card; slot: HTMLElement; onClose: () => void; onPlay?: Props["onPlay"]; onInstall?: Props["onInstall"]; onRename: (game: CatalogGame) => void; onManage?: Props["onManage"] }) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const closing = useRef(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    window.clearTimeout(timer.current);
    if (!menu.current || !motionOk()) { onClose(); return; }
    gsap.to(menu.current, { opacity: 0, x: menu.current.dataset.side === "left" ? 10 : -10, duration: .2, ease: "power2.in", onComplete: onClose });
  }, [onClose]);

  useLayoutEffect(() => {
    const host = menu.current;
    if (!host) return;
    const rect = slot.getBoundingClientRect();
    const width = host.offsetWidth, height = host.offsetHeight;
    // Beside the card, toward the side with more room; vertically centred on the card and kept inside the window.
    const right = rect.right + width <= window.innerWidth - 8 || rect.left < width;
    const left = right ? rect.right - 6 : rect.left - width + 6;
    const top = Math.min(Math.max(8, rect.top + rect.height / 2 - height / 2), window.innerHeight - 60 - height);
    setSide(right ? "right" : "left");
    host.dataset.side = right ? "right" : "left";
    gsap.set(host, { left, top });
    const items = host.querySelectorAll(".ga-side-menu-items button");
    const focusFirst = () => (host.querySelector(".ga-side-menu-items button:not(:disabled)") as HTMLButtonElement | null)?.focus({ preventScroll: true });
    if (!motionOk()) { focusFirst(); return; }
    const tl = gsap.timeline({ onComplete: focusFirst })
      .fromTo(host, { opacity: 0, x: right ? -14 : 14 }, { opacity: 1, x: 0, duration: .35, ease: "power3.out" })
      .fromTo(items, { opacity: 0, x: right ? -8 : 8 }, { opacity: 1, x: 0, duration: .3, stagger: .05, ease: "power3.out" }, "<.08");
    return () => { tl.kill(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Closing depends on where the pointer is, not on which element it crosses: moving between the card, the menu and
    // its buttons never counts as leaving.
    const inside = (event: PointerEvent) => [slot, menu.current].some(el => {
      const r = el?.getBoundingClientRect();
      return r ? event.clientX >= r.left - LEAVE_MARGIN && event.clientX <= r.right + LEAVE_MARGIN && event.clientY >= r.top - LEAVE_MARGIN && event.clientY <= r.bottom + LEAVE_MARGIN : false;
    });
    const move = (event: PointerEvent) => {
      if (inside(event)) { window.clearTimeout(timer.current); timer.current = 0; }
      else if (!timer.current) timer.current = window.setTimeout(() => { timer.current = 0; close(); }, LEAVE_MS);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    const scroll = () => close();
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    return () => { window.clearTimeout(timer.current); timer.current = 0; window.removeEventListener("pointermove", move); window.removeEventListener("keydown", key, true); window.removeEventListener("scroll", scroll, true); };
  }, [slot, close]);

  const deep = card.kind === "deep";
  const run = (action: () => void) => () => { close(); action(); };
  return createPortal(
    <div ref={menu} className="ga-side-menu" data-side={side} role="menu" aria-label={t("flipMenuLabel", { name: card.game.name })}>
      <span className="ga-side-menu-glass" aria-hidden="true" />
      <div className="ga-side-menu-items">
        {card.kind === "pending"
          ? <button type="button" role="menuitem" className="primary" onClick={run(() => void onInstall?.(card.game))}><Download size={15} aria-hidden="true" />{t("flipInstall")}</button>
          : <button type="button" role="menuitem" className="primary" disabled={deep} title={deep ? t("flipFrozenHint") : undefined} onClick={run(() => void onPlay?.(card.game))}><Play size={15} fill="currentColor" aria-hidden="true" />{t("flipPlay")}</button>}
        <button type="button" role="menuitem" onClick={run(() => onRename(card.game))}><Pencil size={15} aria-hidden="true" />{t("renameMenu")}</button>
        <button type="button" role="menuitem" onClick={run(() => onManage?.(card.game))}><SlidersHorizontal size={15} aria-hidden="true" />{t("flipManage")}</button>
      </div>
    </div>,
    document.body,
  );
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
  // The menu dot appears after resting 1 s on a card (or at once with the keyboard); a click turns the card over.
  const [dotFor, setDotFor] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<{ card: Card; slot: HTMLElement } | null>(null);
  const [renaming, setRenaming] = useState<CatalogGame | null>(null);
  const dwell = useRef(0);
  const openMenu = useCallback((card: Card, slot: HTMLElement) => setMenuFor(current => current ?? { card, slot }), []);
  const rest = (id: number) => { window.clearTimeout(dwell.current); dwell.current = window.setTimeout(() => setDotFor(id), DWELL_MS); };
  const leave = (id: number) => { window.clearTimeout(dwell.current); if (menuFor?.card.game.id !== id) setDotFor(current => (current === id ? null : current)); };
  useEffect(() => () => window.clearTimeout(dwell.current), []);
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [rowHeight, setRowHeight] = useState(84);

  const cards = useMemo<Card[]>(() => {
    const entries = new Map(scan.games.map(entry => [entry.app_id, entry]));
    return games.flatMap(game => {
      const status = (game.app_id ? downloads[game.app_id] : undefined) ?? downloads[game.id];
      const state = gameStateManager.resolve(status);
      const entry = game.app_id ? entries.get(game.app_id) : undefined;
      const installed = state.installed || state.prepared || Boolean(entry?.installed);
      if (pill === "installed" && !installed) return [];
      if (pill === "favorites" && preferences[game.id] !== 1) return [];
      const kind: BentoKind = installed ? (entry?.frozen === "deep" ? "deep" : "ready") : "pending";
      return [{ game, kind, frozen: installed ? entry?.frozen : undefined, status }];
    });
  }, [games, downloads, scan.games, pill, preferences]);

  // Columns and row height follow the grid width: three landscape rows are as tall as one portrait.
  useLayoutEffect(() => {
    const host = grid.current;
    if (!host) return;
    const measure = () => {
      const width = host.clientWidth;
      const cols = Math.max(1, Math.floor((width + COLUMN_GAP) / (180 + COLUMN_GAP)));
      const columnWidth = (width - COLUMN_GAP * (cols - 1)) / cols;
      setColumns(cols);
      setRowHeight(bentoRowHeight(columnWidth, ROW_GAP));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(host);
    return () => observer?.disconnect();
  }, []);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const layout = useMemo(() => bentoSections(cards.map(card => ({ kind: card.kind, value: card })), columns, collapsed), [cards, columns, collapsed]);
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
    // A card that comes in shows itself with the reveal of the sliding window (CSS), not a second animation here.
    if (state) Flip.from(state, { targets: grid.current.querySelectorAll(".ga-bento-slot:not([data-leaving]) > .ga-bento-card"), duration: .6, ease: "expo.inOut", absolute: true, delay: gone.length ? .25 : 0 });
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
      <div ref={grid} className="ga-bento" style={{ "--ga-bento-row": `${rowHeight}px`, "--ga-bento-columns": columns, gridTemplateRows: layout.tracks.map(track => (track === "label" ? "0px" : "var(--ga-bento-row)")).join(" ") } as CSSProperties}>
        {layout.sections.map(section => (
          <div key={`section-${section.kind}`} className="ga-bento-divider" data-collapsed={section.collapsed || undefined} style={{ gridColumn: "1 / -1", gridRow: section.row }}>
            <button type="button" aria-expanded={!section.collapsed} onClick={() => toggleGroup(section.kind)}>
              <ChevronRight size={14} aria-hidden="true" /><span>{sectionNames[section.kind]}</span><span className="ga-bento-divider-count">({section.count})</span>
            </button>
          </div>
        ))}
        {shown.map(item => (
          <div key={item.value.game.id} className="ga-bento-slot" style={{ gridColumn: item.column, gridRow: `${item.row} / span ${item.rowSpan}`, "--ga-reveal-delay": `${revealDelay(item)}ms` } as CSSProperties}
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
