import { describe, expect, it } from "vitest";
import { DEFAULT_PIXEL_STYLE, normalizePixelStyle } from "./pixelStylePreferences";
describe("saved appearance preferences", () => {
  it("rejects corrupt storage and non-finite slider values", () => {
    expect(normalizePixelStyle(null)).toEqual(DEFAULT_PIXEL_STYLE);
    expect(normalizePixelStyle({ spd: NaN, cob: "1.2", glass: Infinity, animate: "false" })).toEqual(DEFAULT_PIXEL_STYLE);
  });
  it("bounds values from older settings while preserving valid choices", () => {
    expect(normalizePixelStyle({ spd: 9, cob: -1, glass: .85, animate: false })).toMatchObject({ spd: 3, cob: 0, glass: .85, animate: false });
  });
});
