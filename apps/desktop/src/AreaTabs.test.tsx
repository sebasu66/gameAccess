// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The screen without its animation queue: a plain store, so a change is seen at once.
const screenStore = vi.hoisted(() => {
  let screen = "games";
  const listeners = new Set<() => void>();
  return {
    get: () => screen,
    set: (next: string) => { screen = next; listeners.forEach(listener => listener()); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
});
vi.mock("./appScreen", async () => {
  const { useSyncExternalStore } = await import("react");
  return { setAppScreen: screenStore.set, getAppScreen: screenStore.get, useAppScreen: () => useSyncExternalStore(screenStore.subscribe, screenStore.get, screenStore.get) };
});
vi.mock("./downloads/useActiveDownloadCount", () => ({ useActiveDownloadCount: () => 2 }));

import AreaTabs, { AreaButtons } from "./AreaTabs";
import { AREA_SECTIONS, openSection, setGamesView } from "./gameArea";

let root: Root | null = null;
let container: HTMLElement;
beforeEach(() => {
  screenStore.set("games");
  setGamesView("catalog");
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

const tabs = () => [...container.querySelectorAll(".ga-tab")].map(tab => ({ text: tab.textContent, current: tab.getAttribute("aria-current") === "page" }));

describe("Descargas dentro de Librería (Rediseño de navegación §2)", () => {
  it("Librería tiene Jugar, Descargas y Manager; el Catálogo, una sola sección", () => {
    expect(AREA_SECTIONS).toEqual({ catalog: ["catalog"], library: ["play", "downloads", "manager"] });
  });

  it("la pantalla de Descargas marca Librería › Descargas, con la cantidad en curso", () => {
    act(() => openSection("downloads"));
    expect(screenStore.get()).toBe("downloads");
    act(() => root!.render(<><AreaTabs area="library" /><AreaButtons /></>));
    expect(tabs()).toHaveLength(3);
    expect(tabs()[1]).toEqual({ text: expect.stringContaining("· 2"), current: true });
    // The count of downloads goes on Library's button, not on Catalog's.
    expect(container.querySelector(".ga-library-fab")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".ga-library-fab")?.textContent).toContain("2");
    expect(container.querySelector(".ga-catalog-fab")?.textContent).not.toContain("2");
  });

  it("el Catálogo no dibuja una barra de una sola pestaña", () => {
    act(() => root!.render(<AreaTabs />));
    expect(container.querySelector(".ga-area-tabs")).toBeNull();
    act(() => setGamesView("library"));
    expect(tabs().map(tab => tab.current)).toEqual([true, false, false]);
  });
});
