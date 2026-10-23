import { describe, expect, it } from "vitest";
import { computeShelfWindow } from "./libraryShelfWindow";

// The failure this guards against is a scrollbar whose reserved height depends
// on which slice is mounted: then the thumb jumps, or the scroll snaps back.
const COLUMNS = 6;
const ROW_HEIGHT = 288;
const TOTAL = 41793;
const VIEWPORT = 900;
const metrics = { columns: COLUMNS, rowHeight: ROW_HEIGHT, gridOffsetTop: 0 };

/** What the browser would make scrollable: spacers plus mounted rows. */
function reservedHeight(window: ReturnType<typeof computeShelfWindow>): number {
  const mountedRows = Math.ceil((window.endIndex - window.startIndex) / COLUMNS);
  return window.paddingTop + window.paddingBottom + mountedRows * ROW_HEIGHT;
}

const fullHeight = Math.ceil(TOTAL / COLUMNS) * ROW_HEIGHT;

describe("computeShelfWindow", () => {
  it("reserves the whole list height from any scroll position", () => {
    for (const scrollTop of [0, 1000, 50000, 500000, fullHeight]) {
      const window = computeShelfWindow({ scrollTop, viewportHeight: VIEWPORT, totalCount: TOTAL, metrics, maxCards: 72 });
      expect(reservedHeight(window)).toBe(fullHeight);
    }
  });

  it("never mounts more cards than the DOM ceiling", () => {
    for (const scrollTop of [0, 12345, 999999, fullHeight]) {
      const window = computeShelfWindow({ scrollTop, viewportHeight: VIEWPORT, totalCount: TOTAL, metrics, maxCards: 72 });
      expect(window.endIndex - window.startIndex).toBeLessThanOrEqual(72);
      expect(window.endIndex).toBeLessThanOrEqual(TOTAL);
      expect(window.startIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("covers the visible rows at the scrolled position", () => {
    const scrollTop = 300000;
    const window = computeShelfWindow({ scrollTop, viewportHeight: VIEWPORT, totalCount: TOTAL, metrics, maxCards: 72 });
    const firstVisibleIndex = Math.floor(scrollTop / ROW_HEIGHT) * COLUMNS;
    expect(window.startIndex).toBeLessThanOrEqual(firstVisibleIndex);
    const lastVisibleIndex = Math.ceil((scrollTop + VIEWPORT) / ROW_HEIGHT) * COLUMNS;
    expect(window.endIndex).toBeGreaterThanOrEqual(lastVisibleIndex);
  });

  it("accounts for a grid that starts below the top of the scroller", () => {
    const offset = { ...metrics, gridOffsetTop: 400 };
    // At scrollTop 400 the first row is exactly at the top of the viewport.
    const window = computeShelfWindow({ scrollTop: 400, viewportHeight: VIEWPORT, totalCount: TOTAL, metrics: offset, maxCards: 72 });
    expect(window.startIndex).toBe(0);
    expect(reservedHeight(window)).toBe(fullHeight);
  });

  it("handles empty, tiny and single-row sections without gaps", () => {
    const empty = computeShelfWindow({ scrollTop: 0, viewportHeight: VIEWPORT, totalCount: 0, metrics, maxCards: 72 });
    expect(empty).toEqual({ startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 });

    const tiny = computeShelfWindow({ scrollTop: 0, viewportHeight: VIEWPORT, totalCount: 8, metrics, maxCards: 72 });
    expect(tiny.endIndex).toBe(8);
    expect(tiny.paddingTop).toBe(0);
    expect(tiny.paddingBottom).toBe(0);
  });

  it("honours a ceiling smaller than one viewport of rows", () => {
    const window = computeShelfWindow({ scrollTop: 0, viewportHeight: VIEWPORT, totalCount: TOTAL, metrics, maxCards: 6 });
    expect(window.endIndex - window.startIndex).toBeLessThanOrEqual(6);
    expect(reservedHeight(window)).toBe(fullHeight);
  });
});
