import { describe, expect, it } from "vitest";
import { bentoCells, bentoInWindow, bentoLayout, bentoRowHeight, bentoRowTops, bentoSections, type BentoItem } from "./bentoLayout";

const items = (ready: number, pending: number, deep = 0): BentoItem<string>[] => [
  ...Array.from({ length: ready }, (_, i) => ({ kind: "ready" as const, value: `r${i}` })),
  ...Array.from({ length: pending }, (_, i) => ({ kind: "pending" as const, value: `p${i}` })),
  ...Array.from({ length: deep }, (_, i) => ({ kind: "deep" as const, value: `d${i}` })),
];

describe("library bento layout", () => {
  it("spreads portraits among full stacks and leaves the incomplete stack last", () => {
    const cells = bentoCells(["a", "b"], ["1", "2", "3", "4", "5", "6", "7"]);
    expect(cells.map(cell => `${cell.kind}:${cell.values.length}`)).toEqual(["pending:3", "ready:1", "pending:3", "ready:1", "pending:1"]);
  });

  it("fills complete bands: 7 installed and 11 pending in 6 columns make two bands, the first full", () => {
    const placed = bentoLayout(items(7, 11), 6);
    const firstBand = new Set(placed.filter(p => p.row <= 3).map(p => p.column));
    expect(firstBand.size).toBe(6);
    expect(Math.max(...placed.map(p => p.row + p.rowSpan - 1))).toBe(6);
  });

  it("gives portraits three rows and landscapes one, each landscape under the previous", () => {
    const placed = bentoLayout(items(1, 3), 4);
    const portrait = placed.find(p => p.kind === "ready")!;
    expect(portrait.rowSpan).toBe(3);
    const stack = placed.filter(p => p.kind === "pending");
    expect(new Set(stack.map(p => p.column)).size).toBe(1);
    expect(stack.map(p => p.row)).toEqual([1, 2, 3]);
  });

  it("groups deep-frozen games in the right-hand column", () => {
    const placed = bentoLayout(items(3, 3, 2), 5);
    expect(placed.filter(p => p.kind === "deep").every(p => p.column === 5 && p.rowSpan === 3)).toBe(true);
    expect(placed.filter(p => p.kind !== "deep").every(p => p.column < 5)).toBe(true);
  });

  it("never puts two games in the same slot", () => {
    const placed = bentoLayout(items(5, 8, 4), 4);
    const slots = placed.flatMap(p => Array.from({ length: p.rowSpan }, (_, i) => `${p.column}:${p.row + i}`));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("makes three landscape rows as tall as a portrait column", () => {
    expect(bentoRowHeight(180, 14) * 3 + 2 * 14).toBeCloseTo(270);
  });
});

describe("library bento sections", () => {
  it("stacks installed, frozen and installable games, each under its own divider row", () => {
    const { placements, sections, tracks } = bentoSections(items(5, 4, 2), 4);
    expect(sections.map(s => s.kind)).toEqual(["ready", "deep", "pending"]);
    expect(tracks.filter(t => t === "label")).toHaveLength(3);
    expect(tracks).toHaveLength(Math.max(...placements.map(p => p.row + p.rowSpan - 1)));
    const rows = (kind: string) => placements.filter(p => p.kind === kind).map(p => p.row);
    expect(Math.max(...rows("ready"))).toBeLessThan(Math.min(...rows("deep")));
    expect(Math.max(...rows("deep"))).toBeLessThan(Math.min(...rows("pending")));
    expect(sections.every(s => tracks[s.row - 1] === "label")).toBe(true);
  });

  it("skips empty groups and never overlaps two games", () => {
    const { placements, sections } = bentoSections(items(0, 7, 0), 3);
    expect(sections.map(s => s.kind)).toEqual(["pending"]);
    const slots = placements.flatMap(p => Array.from({ length: p.rowSpan }, (_, i) => `${p.column}:${p.row + i}`));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("lays games to install out in their own wide slots, one wide row per line", () => {
    const { placements, tracks } = bentoSections(items(0, 7, 0), 6, new Set(), 4);
    const pending = placements.filter(p => p.kind === "pending");
    expect(Math.max(...pending.map(p => p.column))).toBe(4);
    expect(new Set(pending.map(p => p.row)).size).toBe(2);
    expect(tracks.filter(t => t === "wide")).toHaveLength(2);
    const tops = bentoRowTops(tracks, 100, 44, 70);
    expect(tops[2] - tops[1]).toBe(70 + 44);
    expect(bentoInWindow(pending, tops, 100, tops[2] + 60, tops[2] + 65, 70).map(p => p.row)).toEqual(Array(3).fill(pending[4].row));
  });

  it("keeps a collapsed group's divider and count but places none of its games", () => {
    const { placements, sections, tracks } = bentoSections(items(5, 4, 2), 4, new Set(["deep", "pending"] as const));
    expect(sections.map(s => [s.kind, s.count, s.collapsed])).toEqual([["ready", 5, false], ["deep", 2, true], ["pending", 4, true]]);
    expect(placements.every(p => p.kind === "ready")).toBe(true);
    // The two closed dividers follow the installed games, one row each.
    expect(sections[2].row).toBe(sections[1].row + 1);
    expect(tracks).toHaveLength(sections[2].row);
    expect(sections.every(s => tracks[s.row - 1] === "label")).toBe(true);
  });
});

describe("library sliding window", () => {
  it("knows where each row starts and mounts only the cards near the band on screen", () => {
    const { placements, tracks } = bentoSections(items(40, 0, 0), 4);
    const tops = bentoRowTops(tracks, 100, 44);
    // Label row: no height, then card rows every 144 px.
    expect(tops.slice(0, 4)).toEqual([0, 44, 188, 332]);
    // A portrait spans three rows (388 px). 10 bands of 4 portraits; a 900 px band in the middle touches 3 or 4 of them.
    const start = tops[3 * 3 + 1];
    const shown = bentoInWindow(placements, tops, 100, start, start + 900);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(4 * 4);
    expect(shown.every(p => (tops[p.row + 2] + 100) >= start && tops[p.row - 1] <= start + 900)).toBe(true);
    expect(bentoInWindow(placements, tops, 100, 0, 900).map(p => p.value)).toContain("r0");
  });
});
