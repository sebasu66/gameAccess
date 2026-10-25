import { describe, expect, it } from "vitest";
import { COVER_GAP, COVER_MIN, COVER_MIN_SMALL, coverMin, overviewCoverSizing } from "./overviewSizing";
describe("catalog cover grid (demo sizing)", () => {
  it("fills the row with covers of at least 176 px and 24 px gaps", () => {
    const { coverFloor, coverColumns } = overviewCoverSizing(1920, 1080, 1200, 50);
    expect(coverColumns).toBe(6);
    expect(coverFloor).toBeGreaterThanOrEqual(COVER_MIN);
    expect(coverFloor * coverColumns + COVER_GAP * (coverColumns - 1)).toBeCloseTo(1200);
  });
  it("makes covers smaller on small windows, so more games fit, between 120 and 176 px", () => {
    expect(coverMin(1920, 1080)).toBe(COVER_MIN);
    expect(coverMin(1600, 950)).toBe(COVER_MIN);
    expect(coverMin(1280, 800)).toBeLessThan(COVER_MIN);
    expect(coverMin(1024, 700)).toBe(COVER_MIN_SMALL);
    expect(coverMin(1920, 700)).toBeLessThan(COVER_MIN);
    expect(overviewCoverSizing(1100, 750, 800, 50).coverColumns).toBeGreaterThan(overviewCoverSizing(1920, 1080, 800, 50).coverColumns);
  });
  it("keeps the cover size for short result lists", () => {
    expect(overviewCoverSizing(1440, 900, 1200, 2).coverFloor).toBeCloseTo(overviewCoverSizing(1440, 900, 1200, 50).coverFloor);
    expect(overviewCoverSizing(1440, 900, 1200, 2).coverColumns).toBe(2);
  });
  it("fits narrow viewports without overflow and uses positive whole column counts", () => {
    for (const width of [320, 760, 1280, 3840]) for (const count of [0, 1, 5, 20, 1000]) {
      const available = Math.max(120, width * .92 - 26);
      const size = overviewCoverSizing(width, 700, available, count);
      expect(size.coverFloor).toBeLessThanOrEqual(available);
      expect(size.coverFloor).toBeGreaterThan(0);
      expect(Number.isInteger(size.coverColumns)).toBe(true);
      expect(size.coverColumns).toBeGreaterThanOrEqual(1);
    }
  });
});
