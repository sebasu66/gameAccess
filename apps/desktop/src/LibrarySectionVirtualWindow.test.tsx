// @vitest-environment jsdom
import { act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LibrarySectionShelf from "./LibrarySectionShelf";
import { resourceGuard, RESOURCE_LIMITS } from "./ResourceGuard";
import type { LibrarySection } from "./librarySections";
import type { CatalogGame } from "./types";

// React only flushes act() work when it knows it is in a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom performs no layout, so every measurement this component depends on has
// to be supplied explicitly. These are the numbers the contract is written
// against: a 6-column grid of 90x270 cards with an 18px gap.
const GRID_WIDTH = 600;
const GRID_HEIGHT = 900;
const CARD_WIDTH = 90;
const CARD_HEIGHT = 270;
const GAP = 18;
const ROW_HEIGHT = CARD_HEIGHT + GAP;
const COLUMNS = 6;
const TOTAL_GAMES = 41793;

function makeSection(count: number): LibrarySection {
  return {
    id: "catalog",
    title: "Catálogo",
    games: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      app_id: 100000 + index,
      slug: `game-${index + 1}`,
      name: `Game ${index + 1}`,
      credit_cost_per_hour: 0,
      copies_total: 1,
      copies_available: 1,
    }) as CatalogGame),
    emptyMessage: "",
  } as LibrarySection;
}

/** Fixed-size rect so the shelf's column/row maths is deterministic. */
function rect(width: number, height: number, top = 0): DOMRect {
  return {
    width, height, top, left: 0, right: width, bottom: top + height, x: 0, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

interface ResizeRecord {
  callback: ResizeObserverCallback;
}

const resizeObservers: ResizeRecord[] = [];

class StubResizeObserver {
  private readonly record: ResizeRecord;
  constructor(callback: ResizeObserverCallback) {
    this.record = { callback };
    resizeObservers.push(this.record);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Plays the browser's "a measured element changed size" signal. */
async function triggerResize(): Promise<void> {
  await act(async () => {
    for (const observer of resizeObservers) {
      observer.callback([], {} as ResizeObserver);
    }
  });
}

interface ObserverRecord {
  callback: IntersectionObserverCallback;
}

const observers: ObserverRecord[] = [];

class StubIntersectionObserver {
  private readonly record: ObserverRecord;
  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback };
    observers.push(this.record);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
}

/** Plays the browser's "the sentinel scrolled into view" signal. */
function revealSentinel(): void {
  act(() => {
    for (const observer of observers) {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** Mutable layout inputs, so a test can simulate the zoom slider / column change. */
let layoutColumns = COLUMNS;
let layoutCardHeight = CARD_HEIGHT;

describe("LibrarySectionShelf virtual window contract", () => {
  beforeEach(() => {
    observers.length = 0;
    resizeObservers.length = 0;
    layoutColumns = COLUMNS;
    layoutCardHeight = CARD_HEIGHT;
    resourceGuard.resetForTesting();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const element = this as HTMLElement;
      if (element.classList.contains("library-room-card")) {
        // Lay the cards out as the browser would, so the component could still
        // fall back to measuring rows when the column variable is absent.
        const index = [...element.parentElement!.children].indexOf(element);
        return rect(CARD_WIDTH, layoutCardHeight, Math.floor(index / layoutColumns) * (layoutCardHeight + GAP));
      }
      if (element.classList.contains("library-section-grid")) return rect(GRID_WIDTH, GRID_HEIGHT);
      return original.call(element);
    });
    // jsdom does not compute custom properties or the CSS `gap` shorthand, so
    // mirror the layout values the app's stylesheet actually provides.
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
      const style = computed(element);
      if ((element as HTMLElement).classList?.contains("library-section-grid")) {
        style.getPropertyValue = (property: string) => (property === "--ga-cover-columns" ? String(layoutColumns) : "");
        Object.defineProperty(style, "rowGap", { configurable: true, value: `${GAP}px` });
      }
      return style;
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => GRID_WIDTH });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => GRID_HEIGHT });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mountShelf(gameCount: number) {
    // The scroll container stands in for .library-room-grid.
    const scrollRoot = document.createElement("div");
    scrollRoot.style.height = `${GRID_HEIGHT}px`;
    document.body.appendChild(scrollRoot);
    const ref = { current: scrollRoot } as RefObject<HTMLDivElement>;
    container = document.createElement("div");
    scrollRoot.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <LibrarySectionShelf
          section={makeSection(gameCount)}
          selectedId={undefined}
          reset={0}
          scrollRoot={ref}
          renderGame={(game) => <button key={game.id} type="button" className="library-room-card" data-game={game.id} />}
        />,
      );
    });
    const grid = scrollRoot.querySelector<HTMLElement>(".library-section-grid");
    if (!grid) throw new Error("shelf did not render a section grid");
    return { scrollRoot, grid };
  }

  const renderedCards = (grid: HTMLElement): number => grid.querySelectorAll(".library-room-card").length;

  const mountedIds = (grid: HTMLElement): number[] =>
    [...grid.querySelectorAll<HTMLElement>(".library-room-card")].map(card => Number(card.dataset.game));

  const spacerTop = (grid: HTMLElement): number => Number.parseFloat(grid.style.paddingTop || "0");
  const spacerBottom = (grid: HTMLElement): number => Number.parseFloat(grid.style.paddingBottom || "0");

  /** The scrollbar height the spacers imply. Must always equal the full list. */
  function impliedScrollHeight(grid: HTMLElement): number {
    const mountedRows = Math.ceil(renderedCards(grid) / COLUMNS);
    return spacerTop(grid) + spacerBottom(grid) + mountedRows * ROW_HEIGHT;
  }

  const fullListHeight = Math.ceil(TOTAL_GAMES / COLUMNS) * ROW_HEIGHT;

  function scrollTo(target: HTMLElement, top: number): void {
    act(() => {
      target.scrollTop = top;
      target.dispatchEvent(new Event("scroll"));
    });
  }

  it("keeps the DOM bounded even after the sentinel repeatedly asks for more", async () => {
    const { grid } = await mountShelf(TOTAL_GAMES);

    for (let i = 0; i < 40; i++) revealSentinel();

    expect(renderedCards(grid)).toBeGreaterThan(0);
    expect(renderedCards(grid)).toBeLessThanOrEqual(RESOURCE_LIMITS.MAX_DOM_CARDS);
  });

  it("reserves the full list height with spacers instead of mounting it", async () => {
    const { grid } = await mountShelf(TOTAL_GAMES);

    // A scrollbar sized by mounted cards would be a fraction of the real list,
    // so the thumb would jump. The spacers must account for every off-screen row.
    expect(impliedScrollHeight(grid)).toBeCloseTo(fullListHeight, 0);
  });

  it("keeps the reserved height constant as the window moves", async () => {
    const { scrollRoot, grid } = await mountShelf(TOTAL_GAMES);

    for (const top of [0, 2000, 20000, 120000, 400000]) {
      scrollTo(scrollRoot, top);
      expect(renderedCards(grid)).toBeLessThanOrEqual(RESOURCE_LIMITS.MAX_DOM_CARDS);
      expect(impliedScrollHeight(grid)).toBeCloseTo(fullListHeight, 0);
    }
  });

  it("mounts cards from the scrolled region instead of always the first ones", async () => {
    const { scrollRoot, grid } = await mountShelf(TOTAL_GAMES);

    scrollTo(scrollRoot, 0);
    expect(Math.min(...mountedIds(grid))).toBe(1);

    scrollTo(scrollRoot, 300000);
    const later = mountedIds(grid);
    // 300000 / 288 is roughly row 1041, i.e. game ~6247. The first cards must
    // be gone: mounting the head while scrolled to the tail is the bug.
    expect(Math.min(...later)).toBeGreaterThan(1000);
    expect(later).not.toContain(1);
  });

  it("does not window a small section into permanent gaps", async () => {
    const { grid } = await mountShelf(8);

    expect(renderedCards(grid)).toBe(8);
    expect(impliedScrollHeight(grid)).toBe(2 * ROW_HEIGHT);
  });

  // The zoom slider and the result-count sizing change a card's height without
  // resizing the grid box, so a window that only watches the grid keeps stale
  // rows and mislays the spacers.
  it("re-measures rows and columns when the zoom slider changes card size", async () => {
    const { scrollRoot, grid } = await mountShelf(TOTAL_GAMES);

    scrollTo(scrollRoot, 20000);
    const beforeColumns = 6;
    const beforeRowHeight = CARD_HEIGHT + GAP;
    const beforeBottom = spacerBottom(grid);
    expect(renderedCards(grid)).toBeLessThanOrEqual(RESOURCE_LIMITS.MAX_DOM_CARDS);

    // Zoom in: cards get taller, and fewer fit per row.
    layoutCardHeight = 380;
    layoutColumns = 4;
    await triggerResize();

    // Rows and columns must both follow the new layout, not the stale one.
    const zoomedRowHeight = layoutCardHeight + GAP;
    const zoomedRows = Math.ceil(TOTAL_GAMES / layoutColumns);
    expect(renderedCards(grid)).toBeLessThanOrEqual(RESOURCE_LIMITS.MAX_DOM_CARDS);
    // Fewer, taller rows: the reserved tail must shrink relative to the old grid.
    const beforeFullHeight = Math.ceil(TOTAL_GAMES / beforeColumns) * beforeRowHeight;
    const zoomedFullHeight = zoomedRows * zoomedRowHeight;
    expect(zoomedFullHeight).not.toBe(beforeFullHeight);
    // The spacers are stated in the new row height, so they cannot still be a
    // multiple of the old one.
    expect(spacerBottom(grid)).not.toBe(beforeBottom);
    expect(spacerTop(grid) % zoomedRowHeight).toBe(0);
    expect(spacerBottom(grid) % zoomedRowHeight).toBe(0);
  });

  it("does not move the scroll for a selection the scroll itself made", async () => {
    // Regression: while scrolling, the catalog moves the selection to a card on screen (scrollClamping); the shelf
    // tweened back to that card, pulling the scroll up on every wheel step, so the catalog stopped loading.
    const { scrollRoot, grid } = await mountShelf(TOTAL_GAMES);
    const ref = { current: scrollRoot } as RefObject<HTMLDivElement>;
    const render = (selectedId?: number) => act(() => root?.render(
      <LibrarySectionShelf section={makeSection(TOTAL_GAMES)} selectedId={selectedId} reset={0} scrollRoot={ref}
        renderGame={(game) => <button key={game.id} type="button" className={`library-room-card${game.id === selectedId ? " is-selected" : ""}`} data-game={game.id} />} />,
    ));
    render(1);
    scrollTo(scrollRoot, 50 * ROW_HEIGHT + 40);
    const onScreen = mountedIds(grid)[COLUMNS * 2];
    scrollRoot.dataset.scrollClamping = "true";
    render(onScreen);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    expect(scrollRoot.scrollTop).toBe(50 * ROW_HEIGHT + 40);
    expect(scrollRoot.dataset.scrollClamping).toBeUndefined();
  });
});
