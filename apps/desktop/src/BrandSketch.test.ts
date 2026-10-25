import { describe, expect, it } from "vitest";
import { sketchProgress } from "./BrandSketch";

// The loop (tools/brand/animation-studio.html, 858 frames at 30 fps = 28.6 s) reads as G at 0 s and as A at 14.3 s.
describe("sketched word under the logo", () => {
  it("shows GAME whole around the G and ACCESS whole around the A", () => {
    for (const t of [0, 2.5, 28.6 - 2.5]) expect(sketchProgress(t)).toEqual({ game: 1, access: 0 });
    for (const t of [14.3, 12, 16.6]) expect(sketchProgress(t)).toEqual({ game: 0, access: 1 });
  });

  it("erases GAME and then builds ACCESS while the logo turns from G to A (and back)", () => {
    const samples = [3.5, 5, 6.5, 7.3, 8, 9.5, 10.8].map(sketchProgress);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].game).toBeLessThanOrEqual(samples[i - 1].game);
      expect(samples[i].access).toBeGreaterThanOrEqual(samples[i - 1].access);
    }
    expect(samples[1].game).toBeGreaterThan(0);
    expect(samples[1].game).toBeLessThan(1);
    expect(samples[5].access).toBeGreaterThan(0);
    expect(samples[5].access).toBeLessThan(1);
    // Never both at once: one word is gone before the other starts.
    for (let t = 0; t < 28.6; t += .1) { const p = sketchProgress(t); expect(Math.min(p.game, p.access)).toBe(0); }
  });

  it("goes back the same way from A to G", () => {
    const back = sketchProgress(28.6 - 5), there = sketchProgress(5);
    expect(back.game).toBeCloseTo(there.game, 9);
    expect(back.access).toBeCloseTo(there.access, 9);
  });
});
