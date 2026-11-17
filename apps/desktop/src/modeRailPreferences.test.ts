// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MODE_RAIL, loadModeRail, MODE_RAIL_EVENT, MODE_RAIL_KEY, normalizeModeRail, railAttributes, saveModeRail } from "./modeRailPreferences";

afterEach(() => localStorage.clear());

describe("mode rail preferences", () => {
  it("starts with the included caps, fitted Bebas Neue and no custom CSS", () => {
    expect(loadModeRail()).toEqual(DEFAULT_MODE_RAIL);
    expect(DEFAULT_MODE_RAIL).toMatchObject({ enabled: true, background: "caps", font: "Bebas Neue", size: null, css: "" });
  });

  it("keeps what was saved and announces it", () => {
    let announced: unknown = null;
    const listen = (event: Event) => { announced = (event as CustomEvent).detail; };
    window.addEventListener(MODE_RAIL_EVENT, listen);
    expect(saveModeRail({ ...DEFAULT_MODE_RAIL, orientation: "stacked", ink: "#ff7a2e", css: ".word { color: red; }" })).toBe(true);
    window.removeEventListener(MODE_RAIL_EVENT, listen);
    expect(loadModeRail()).toMatchObject({ orientation: "stacked", ink: "#ff7a2e", css: ".word { color: red; }" });
    expect(announced).toMatchObject({ orientation: "stacked" });
  });

  it("clamps numbers and drops values it does not know", () => {
    const prefs = normalizeModeRail({ width: 900, duration: -1, strips: 5.6, orientation: "sideways", ink: "red", blend: "plus", background: "custom", backgroundData: "http://x/y.png" });
    expect(prefs).toMatchObject({ width: 180, duration: .15, strips: 6, orientation: "up", ink: null, blend: "normal", background: "caps", backgroundData: null });
  });

  it("reads a broken stored value as the defaults", () => {
    localStorage.setItem(MODE_RAIL_KEY, "{not json");
    expect(loadModeRail()).toEqual(DEFAULT_MODE_RAIL);
  });

  it("turns the choices into the element's attributes", () => {
    const attrs = railAttributes({ ...DEFAULT_MODE_RAIL, hazard: false, strokeWidth: 2, stroke: "#ffffff", contrast: 1.25 }, "library", "BIBLIOTECA");
    expect(attrs).toMatchObject({ mode: "library", label: "BIBLIOTECA", bg: "/mode-rail/caps.png", hazard: "off", stroke: "#ffffff", "stroke-width": "2", "bg-contrast": "1.25", size: null, css: null });
    expect(railAttributes({ ...DEFAULT_MODE_RAIL, background: "none" }, "home", "HOME")).toMatchObject({ bg: null, "bg-blend": null, "bg-strips": null });
  });
});
