import { describe, expect, it, vi } from "vitest";
import { bigPictureActive, controllerConnected, setBigPictureActive } from "./bigPicture";
import { closeAllPanels, deskOpen, openPanel } from "./desk/desk";

const pad = { connected: true } as Gamepad;

describe("big picture mode", () => {
  it("needs a controller: the webview's list first, then Windows in the app", async () => {
    expect(await controllerConnected({ native: false, ask: async () => 1, pads: () => [] })).toBe(false);
    expect(await controllerConnected({ native: false, ask: async () => 0, pads: () => [null, pad] })).toBe(true);
    const ask = vi.fn(async () => 1);
    expect(await controllerConnected({ native: true, ask, pads: () => [] })).toBe(true);
    expect(await controllerConnected({ native: true, ask: async () => 0, pads: () => [] })).toBe(false);
    expect(await controllerConnected({ native: true, ask: async () => { throw new Error("no command"); }, pads: () => [] })).toBe(false);
  });

  it("keeps the side panels closed while it is on", () => {
    closeAllPanels();
    setBigPictureActive(true);
    openPanel("downloads");
    expect(deskOpen()).toEqual([]);
    setBigPictureActive(false);
    expect(bigPictureActive()).toBe(false);
    openPanel("downloads");
    expect(deskOpen()).toEqual(["downloads"]);
    closeAllPanels();
  });
});
