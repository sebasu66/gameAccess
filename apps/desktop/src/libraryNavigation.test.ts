import { describe, expect, it } from "vitest";
import { calculateSelectionScrollTop } from "./libraryNavigation";

describe("portrait library selection scrolling", () => {
  it("keeps a visible selection still", () => {
    expect(calculateSelectionScrollTop({ scrollTop: 100, viewportHeight: 400, itemTop: 180, itemHeight: 120 })).toBe(100);
  });
  it("scrolls down when keyboard selection leaves the viewport", () => {
    expect(calculateSelectionScrollTop({ scrollTop: 0, viewportHeight: 400, itemTop: 430, itemHeight: 120, padding: 8 })).toBe(158);
  });
  it("scrolls up when keyboard selection moves above the viewport", () => {
    expect(calculateSelectionScrollTop({ scrollTop: 500, viewportHeight: 400, itemTop: 420, itemHeight: 120, padding: 8 })).toBe(412);
  });
});
