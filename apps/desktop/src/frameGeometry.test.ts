import { describe, expect, it } from "vitest";
import { FRAME, JOIN_CUT, frameFillPath, frameInnerPath, tabAround, tabMerge, type FrameMetrics } from "./frameGeometry";

const m: FrameMetrics = { width: 1600, height: 900, ...FRAME };
const I = m.inset;
const points = (path: string) => [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(p => [Number(p[1]), Number(p[2])]);

describe("device frame geometry", () => {
  it("is a cut rectangle at the inset when nothing sits on the edges", () => {
    const pts = points(frameInnerPath(m, []));
    expect(pts).toHaveLength(8);
    expect(Math.min(...pts.map(p => p[0]))).toBe(I);
    expect(Math.max(...pts.map(p => p[0]))).toBe(1600 - I);
    expect(Math.max(...pts.map(p => p[1]))).toBe(900 - I);
  });

  it("steps inward around each tab and keeps the points in order along each edge", () => {
    const banner = tabAround("top", { left: 170, top: 124, right: 1404, bottom: 394 }, m)!;
    const dock = tabAround("bottom", { left: 1292, top: 857, right: 1578, bottom: 895 }, m)!;
    const logo = tabAround("right", { left: 1500, top: 292, right: 1572, bottom: 608 }, m)!;
    const pts = points(frameInnerPath(m, [banner, dock, logo]));
    // The banner tab reaches down to below the banner, the dock tab up above the dock, the logo tab left of the logo.
    expect(pts.some(([, y]) => y === 402)).toBe(true);
    expect(pts.some(([, y]) => y === 849)).toBe(true);
    expect(pts.some(([x]) => x === 1492)).toBe(true);
    // Top edge left to right, bottom edge right to left (clockwise).
    const top = pts.filter(([, y]) => y === I).map(([x]) => x);
    expect(top).toEqual([...top].sort((a, b) => a - b));
    const bottom = pts.filter(([, y]) => y === 900 - I).map(([x]) => x);
    expect(bottom).toEqual([...bottom].sort((a, b) => b - a));
  });

  it("a tab with no depth (a closed drawer) lies flat on the edge", () => {
    const closed = points(frameInnerPath(m, [{ edge: "top", from: 170, to: 1404, depth: 0 }]));
    expect(closed.every(([, y]) => y >= I)).toBe(true);
    expect(closed.filter(([x]) => x > 100 && x < 1500).every(([, y]) => y === I)).toBe(true);
  });

  it("cuts the inside corner where a tab leaves its edge at 45°, like its own corners", () => {
    const logo = tabAround("right", { left: 1500, top: 300, right: 1572, bottom: 600 }, m)!;
    const pts = points(frameInnerPath(m, [logo])).map(p => p.join(","));
    const edge = 1600 - I, j = JOIN_CUT;
    // Down the right edge to just above the tab, then 45° in onto the tab's top edge (and the mirror below it).
    expect(pts).toContain(`${edge},${logo.from - j}`);
    expect(pts).toContain(`${edge - j},${logo.from}`);
    expect(pts).toContain(`${edge - j},${logo.to}`);
    expect(pts).toContain(`${edge},${logo.to + j}`);
  });

  it("a bottom tab that reaches a corner takes the corner in instead of stepping back before the cut", () => {
    const dock = tabAround("bottom", { left: 1292, top: 857, right: 1578, bottom: 895 }, m)!;
    const status = tabAround("bottom", { left: 30, top: 857, right: 250, bottom: 895 }, m)!;
    expect(tabMerge(m, dock)).toEqual({ left: false, right: true });
    expect(tabMerge(m, status)).toEqual({ left: true, right: false });
    const pts = points(frameInnerPath(m, [dock, status]));
    const top = 857 - 8;
    // The right edge comes straight down onto the dock tab's top; the status tab's top runs into the left edge.
    expect(pts).toContainEqual([1600 - I, top - JOIN_CUT]);
    expect(pts).toContainEqual([1600 - I - JOIN_CUT, top]);
    expect(pts).toContainEqual([I + JOIN_CUT, top]);
    expect(pts).toContainEqual([I, top - JOIN_CUT]);
    // No corner cut of the frame is left at the bottom.
    expect(pts.some(([x, y]) => x === 1600 - I - m.corner && y === 900 - I)).toBe(false);
    expect(pts.some(([x, y]) => x === I + m.corner && y === 900 - I)).toBe(false);
  });

  it("fills the band and the tabs (the window with the inner shape cut out)", () => {
    expect(frameFillPath(m, [])).toMatch(/^M0 0 H1600 V900 H0 Z M/);
  });

  it("no element, no tab", () => {
    expect(tabAround("top", null, m)).toBeNull();
  });
});
