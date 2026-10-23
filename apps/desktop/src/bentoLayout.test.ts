import { describe, expect, it } from "vitest";
import { bentoCells, bentoLayout, bentoRowHeight, type BentoItem } from "./bentoLayout";

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
    expect(placed.filter(p => p.kind === "deep").every(p => p.column === 5)).toBe(true);
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
