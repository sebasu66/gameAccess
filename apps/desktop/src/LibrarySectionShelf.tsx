import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { calculateSelectionScrollTop, selectionItemTopInScrollContainer, tweenSelectionScroll } from "./libraryNavigation";
import type { ReactElement, ReactNode, RefObject } from "react";
import { SECTION_PREVIEW_SIZE } from "./librarySections";
import { narrate } from "./narrationLog";
import { resourceGuard, RESOURCE_LIMITS } from "./ResourceGuard";
import { computeShelfWindow, type ShelfWindow, type ShelfWindowMetrics } from "./libraryShelfWindow";
import type { LibrarySection } from "./librarySections";
import type { CatalogGame } from "./types";
import { useI18n } from "./i18n";

interface Props {
  section: LibrarySection;
  selectedId?: number;
  renderGame: (game: CatalogGame) => ReactNode;
  reset: number;
  scrollRoot: RefObject<HTMLDivElement>;
}

/** Provisional grid shape used for the first paint, before the DOM is measured. */
const FALLBACK_COLUMNS = 6;
const FALLBACK_ROW_HEIGHT = 288;
const FALLBACK_VIEWPORT_HEIGHT = 900;
// Only the rows on screen plus one above and one below are mounted (sliding window); cards appear as they come in.
const SHELF_BUFFER_ROWS = 1;

export default function LibrarySectionShelf({ section, selectedId, renderGame, reset, scrollRoot }: Props) {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<ShelfWindowMetrics | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(900);
  const [resetToken, setResetToken] = useState(0);
  const previousVisibleCountRef = useRef(SECTION_PREVIEW_SIZE);
  const selectionScrollPendingRef = useRef(false);
  const recenterPendingRef = useRef(false);
  const rootRef = useRef<HTMLElement>(null);
  const cancelTween = useRef<() => void>(() => {});
  const lastColumns = useRef(FALLBACK_COLUMNS);
  const fallbackViewportHeight = useRef(FALLBACK_VIEWPORT_HEIGHT);

  const totalCount = section.games.length;
  const windowRange: ShelfWindow = useMemo(() => computeShelfWindow({
    scrollTop,
    viewportHeight,
    totalCount,
    metrics: metrics ?? { columns: FALLBACK_COLUMNS, rowHeight: FALLBACK_ROW_HEIGHT, gridOffsetTop: 0 },
    maxCards: RESOURCE_LIMITS.MAX_DOM_CARDS,
    bufferRows: SHELF_BUFFER_ROWS,
    previewLimit: metrics ? undefined : SECTION_PREVIEW_SIZE,
  }), [scrollTop, viewportHeight, totalCount, metrics]);

  useEffect(() => {
    const root = scrollRoot.current;
    const stop = () => cancelTween.current();
    const key = (event: globalThis.KeyboardEvent) => { if (!event.key.startsWith("Arrow")) stop(); };
    root?.addEventListener("wheel", stop, { passive: true });
    root?.addEventListener("touchstart", stop, { passive: true });
    root?.closest<HTMLElement>(".library-room")?.addEventListener("pointerdown", stop, { passive: true });
    root?.closest<HTMLElement>(".library-room")?.addEventListener("keydown", key);
    return () => { stop(); root?.removeEventListener("wheel", stop); root?.removeEventListener("touchstart", stop); root?.closest<HTMLElement>(".library-room")?.removeEventListener("pointerdown", stop); root?.closest<HTMLElement>(".library-room")?.removeEventListener("keydown", key); };
  }, [scrollRoot]);

  // A toolbar reset returns the shelf to its initial preview.
  // biome-ignore lint/correctness/useExhaustiveDependencies: The reset token intentionally restores this shelf preview.
  useEffect(() => {
    setScrollTop(0);
    setMetrics(null);
    setResetToken(token => token + 1);
  }, [reset]);

  // Card metrics depend on the zoom slider / result-count sizing published as
  // --ga-cover-floor and --ga-cover-columns, not on the grid's own box. A zoom
  // change alters a card's height without necessarily resizing the grid, so the
  // window would keep stale rows. Observing one card is the reliable signal.
  const [metricCard, setMetricCard] = useState<HTMLElement | null>(null);
  const metricCardRef = useCallback((node: HTMLElement | null) => { setMetricCard(node); }, []);

  useLayoutEffect(() => {
    const root = scrollRoot.current;
    const grid = rootRef.current?.querySelector<HTMLElement>(".library-section-grid");
    if (!root || !grid) return;

    // Columns come from the grid's own layout variables when the parent
    // publishes them, so the window never has to re-derive CSS grid maths.
    // The rendered-card fallback matters during the first paint, before CSS
    // has laid the grid out.
    const countColumns = (): number => {
      const declared = Number.parseInt(getComputedStyle(grid).getPropertyValue("--ga-cover-columns"), 10);
      if (Number.isFinite(declared) && declared > 0) return declared;
      const attribute = Number.parseInt(grid.dataset.coverColumns ?? "", 10);
      if (Number.isFinite(attribute) && attribute > 0) return attribute;
      const cards = grid.querySelectorAll<HTMLElement>(".library-room-card");
      if (!cards.length) return lastColumns.current;
      const perRow = new Map<number, number>();
      cards.forEach(card => {
        const top = Math.round(card.getBoundingClientRect().top);
        perRow.set(top, (perRow.get(top) ?? 0) + 1);
      });
      return Math.max(1, Math.max(...perRow.values()));
    };

    const measure = () => {
      const firstCard = grid.querySelector<HTMLElement>(".library-room-card");
      if (!firstCard) return;
      const cardRect = firstCard.getBoundingClientRect();
      if (cardRect.height <= 0) return;
      const columns = countColumns();
      lastColumns.current = columns;
      const rowGap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;
      const rootHeight = root.clientHeight || fallbackViewportHeight.current;
      setViewportHeight(rootHeight);
      // offsetTop is layout-derived, so it does not move with the scroll
      // position and does not depend on the spacers this component writes.
      setMetrics({
        columns,
        rowHeight: Math.max(1, cardRect.height + rowGap),
        gridOffsetTop: Math.max(0, grid.offsetTop || 0),
      });
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    resizeObserver.observe(grid);
    if (metricCard) resizeObserver.observe(metricCard);
    measure();
    return () => resizeObserver.disconnect();
  }, [scrollRoot, totalCount, resetToken, metricCard]);

  const windowInputs = useRef({ viewportHeight, totalCount, metrics, windowRange });
  windowInputs.current = { viewportHeight, totalCount, metrics, windowRange };
  useEffect(() => {
    const root = scrollRoot.current;
    if (!root) return;
    // Scroll fires several times per frame. Rendering the shelf on each one re-rendered every
    // mounted card (hundreds of renders a second, 5 fps); only a new card window needs a render.
    const onScroll = () => {
      const { viewportHeight, totalCount, metrics, windowRange } = windowInputs.current;
      const next = computeShelfWindow({
        scrollTop: root.scrollTop,
        viewportHeight,
        totalCount,
        metrics: metrics ?? { columns: FALLBACK_COLUMNS, rowHeight: FALLBACK_ROW_HEIGHT, gridOffsetTop: 0 },
        maxCards: RESOURCE_LIMITS.MAX_DOM_CARDS,
        bufferRows: SHELF_BUFFER_ROWS,
        previewLimit: metrics ? undefined : SECTION_PREVIEW_SIZE,
      });
      if (next.startIndex !== windowRange.startIndex || next.endIndex !== windowRange.endIndex) setScrollTop(root.scrollTop);
    };
    setScrollTop(root.scrollTop);
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [scrollRoot]);

  const selectedPosition = section.games.findIndex(game => game.id === selectedId);
  useLayoutEffect(() => {
    cancelTween.current();
    selectionScrollPendingRef.current = true;
    recenterPendingRef.current = true;
  }, [selectedId]);

  // Keyboard navigation can target a card the window is not mounting yet:
  // scroll it into range first so the selection is always renderable.
  useEffect(() => {
    // Only a change of selected game may move the scroll. A list that reorders
    // or grows (metadata, favorites, lazy batches) moves the same game to a new
    // index; recentering on that made clicks jump many rows down.
    if (selectedPosition < 0 || !recenterPendingRef.current) return;
    const root = scrollRoot.current;
    const grid = rootRef.current?.querySelector<HTMLElement>(".library-section-grid");
    if (!root || !grid) return;
    recenterPendingRef.current = false;
    const active = metrics ?? { columns: FALLBACK_COLUMNS, rowHeight: FALLBACK_ROW_HEIGHT, gridOffsetTop: 0 };
    const target = computeShelfWindow({
      scrollTop,
      viewportHeight,
      totalCount,
      metrics: active,
      maxCards: RESOURCE_LIMITS.MAX_DOM_CARDS,
      bufferRows: SHELF_BUFFER_ROWS,
    });
    if (selectedPosition >= target.startIndex && selectedPosition < target.endIndex) return;
    const selectedRow = Math.floor(selectedPosition / active.columns);
    const nextTop = Math.max(0, active.gridOffsetTop + selectedRow * active.rowHeight - Math.floor(viewportHeight / 3));
    root.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [selectedPosition, totalCount, scrollTop, viewportHeight, metrics, scrollRoot]);

  const visibleGames = section.games.slice(windowRange.startIndex, windowRange.endIndex);
  useEffect(() => {
    resourceGuard.trackMountedCards(visibleGames.length, `shelf-${section.id}`);
  }, [visibleGames.length, section.id]);

  useLayoutEffect(() => {
    if (!selectionScrollPendingRef.current) return;
    const selected = rootRef.current?.querySelector<HTMLElement>(".is-selected");
    const root = scrollRoot.current;
    if (!selected || !root) return;
    // One scroll owner, keyed by game identity. Metadata/favorite reordering
    // must not reveal the same selected game at its new sorted position.
    const rect = selected.getBoundingClientRect();
    const target = calculateSelectionScrollTop({ scrollTop: root.scrollTop,
      viewportHeight: root.clientHeight,
      itemTop: selectionItemTopInScrollContainer({ scrollTop: root.scrollTop, viewportTop: root.getBoundingClientRect().top, itemTop: rect.top }),
      itemHeight: rect.height });
    cancelTween.current = tweenSelectionScroll(root, target);
    if (root.closest(".library-room")?.contains(document.activeElement) && !document.activeElement?.closest('[role="dialog"], input, select, textarea, .library-catalog-toolbar')) {
      selected.focus({ preventScroll: true });
    }
    selectionScrollPendingRef.current = false;
  }, [selectedId, windowRange.startIndex, windowRange.endIndex, scrollRoot]);

  useEffect(() => {
    const previous = previousVisibleCountRef.current;
    previousVisibleCountRef.current = visibleGames.length;
    if (visibleGames.length > previous) {
      void narrate(`Infinite scroll loaded ${visibleGames.length - previous} more ${section.id} game card(s); ${visibleGames.length}/${section.games.length} are visible.`, { area: "CATALOG" });
    }
  }, [section.games.length, section.id, visibleGames.length]);

  return <section ref={rootRef} className="library-section" aria-label={section.title}>
    <header className="library-section-heading">
      <div>
        <h2>{section.title} <small>{section.total ?? section.games.length}</small></h2>
        {section.description ? <span>{section.description}</span> : section.id === "installed" ? <span>{t("uiUltimosJugadosPrimero")}</span> : null}
      </div>
    </header>
    <div id={`section-${section.id}`} className="library-section-grid" style={{ paddingTop: `${windowRange.paddingTop}px`, paddingBottom: `${windowRange.paddingBottom}px` }}>{visibleGames.map((game, index) => {
      const node = renderGame(game);
      // One representative card is measured for row height; the zoom slider and
      // column variables change its size without resizing the grid itself.
      if (index !== 0 || !isValidElement(node)) return node;
      return cloneElement(node as ReactElement, { ref: metricCardRef });
    })}</div>
    {!section.games.length ? <p className="library-section-empty">{section.emptyMessage ?? t("sectionEmptyDefault")}</p> : null}
  </section>;
}
