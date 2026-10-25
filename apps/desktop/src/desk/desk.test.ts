import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAllPanels, closePanel, deskOpen, openPanel, togglePanel } from "./desk";

const wideWindow = (wide: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));

describe("desk panels", () => {
  afterEach(() => { closeAllPanels(); vi.unstubAllGlobals(); });
  it("keeps several panels open side by side in a wide window", () => {
    wideWindow(true);
    openPanel("manager"); openPanel("downloads"); openPanel("news");
    expect(deskOpen()).toEqual(["manager", "downloads", "news"]);
    togglePanel("downloads");
    expect(deskOpen()).toEqual(["manager", "news"]);
  });
  it("shows one panel at a time in a small window", () => {
    wideWindow(false);
    openPanel("manager"); openPanel("downloads");
    expect(deskOpen()).toEqual(["downloads"]);
    closePanel("downloads");
    expect(deskOpen()).toEqual([]);
  });
});
