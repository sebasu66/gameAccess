import { describe, expect, it } from "vitest";
import { normalizeOverviewZoom, overviewCoverSizing } from "./overviewSizing";
describe("overview zoom combined with automatic grid sizing", () => {
  it("makes the dense default floor 10 percent larger than the former automatic baseline", () => {
    // 1200px grid: six former baseline columns, 28px gaps, 77% dense scale.
    const previousFloor = ((1200 - 5 * 28) / 6) * .77;
    expect(overviewCoverSizing(1440, 900, 1200, 50).coverFloor).toBeCloseTo(previousFloor * 1.1);
  });
  it("increases cover size and reduces columns while retaining sparse-search enlargement", () => {
    const normal = overviewCoverSizing(1920, 1080, 1700, 300);
    const enlarged = overviewCoverSizing(1920, 1080, 1700, 300, 140);
    expect(enlarged.coverFloor).toBeCloseTo(normal.coverFloor * 1.4);
    expect(enlarged.coverColumns).toBeLessThan(normal.coverColumns);
    expect(overviewCoverSizing(1920, 1080, 1700, 3, 140).coverFloor).toBeGreaterThan(enlarged.coverFloor);
  });
  it("fits narrow viewports without overflow and uses positive whole column counts", () => {
    for (const width of [320, 760, 1280, 3840]) for (const count of [0, 1, 5, 20, 1000]) {
      const available = Math.max(120, width * .92 - 26);
      const size = overviewCoverSizing(width, 700, available, count, 160);
      expect(size.coverFloor).toBeLessThanOrEqual(available);
      expect(size.coverFloor).toBeGreaterThan(0);
      expect(Number.isInteger(size.coverColumns)).toBe(true);
      expect(size.coverColumns).toBeGreaterThanOrEqual(1);
    }
  });
  it("rejects corrupt saved values and clamps valid zoom preferences", () => {
    for (const value of [null, "140", NaN, Infinity]) expect(normalizeOverviewZoom(value)).toBe(100);
    expect(normalizeOverviewZoom(80)).toBe(100);
    expect(normalizeOverviewZoom(190)).toBe(160);
    expect(normalizeOverviewZoom(140)).toBe(140);
  });
});
