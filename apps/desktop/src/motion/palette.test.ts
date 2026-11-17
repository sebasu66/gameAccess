import { describe, expect, it } from "vitest";
import { calm, paletteFromPixels } from "./palette";

const pixels = (list: Array<[number, number, number, number]>) => list.flatMap(([color, r, g, b]) => Array.from({ length: color }, () => [r, g, b, 255]).flat());

describe("cover palette", () => {
  it("keeps the most common vivid colours and leaves out near-black and near-white", () => {
    const data = pixels([[50, 5, 5, 5], [40, 250, 250, 250], [30, 200, 40, 30], [20, 30, 60, 190], [10, 204, 44, 34]]);
    const palette = paletteFromPixels(data);
    expect(palette).toHaveLength(2);
    expect(palette[0][0]).toBeGreaterThan(190);
    expect(palette[1][2]).toBeGreaterThan(180);
  });

  it("calms bright colours down to a mid tone", () => {
    expect(Math.max(...calm([255, 128, 0]))).toBe(150);
    expect(calm([60, 40, 20])).toEqual([60, 40, 20]);
  });
});
