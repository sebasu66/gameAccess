// @vitest-environment jsdom
/**
 * The real rail and the real settings together (no stand-ins): what the user changes reaches <ga-mode-rail> and the
 * saved preferences; CSS that cannot be read is refused with the error, and nothing changes.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ModeRail from "./ModeRail";
import ModeRailSettings from "./ModeRailSettings";
import { setAppLocale } from "./i18n";
import { loadModeRail } from "./modeRailPreferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
  setAppLocale("es");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(<><ModeRail /><ModeRailSettings /></>); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove(); root = null; host = null; localStorage.clear();
});

const rail = () => document.querySelector("ga-mode-rail") as HTMLElement & { settled: () => Promise<void>; shownText: string } | null;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === name)!;
const typeCss = (text: string) => {
  const area = document.getElementById("ga-rail-css") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(area, text); area.dispatchEvent(new Event("input", { bubbles: true })); });
};
const apply = async () => { await act(async () => { button("Aplicar estilo").click(); await new Promise(resolve => setTimeout(resolve, 80)); }); };

describe("mode rail settings", () => {
  it("shows the rail with the catalog's word and makes room for it", async () => {
    const element = rail();
    expect(element).not.toBeNull();
    expect(element!.getAttribute("mode")).toBe("catalog");
    expect(element!.getAttribute("label")).toBe("CATÁLOGO");
    await act(async () => { await element!.settled(); });
    expect(element!.shownText).toBe("CATÁLOGO");
    expect(document.documentElement.classList.contains("ga-mode-rail-on")).toBe(true);
  });

  it("previews another mode on the real rail", async () => {
    act(() => { button("AJUSTES").click(); });
    expect(rail()!.getAttribute("mode")).toBe("settings");
    await act(async () => { await rail()!.settled(); });
    expect(rail()!.shownText).toBe("AJUSTES");
    act(() => { button("Modo actual").click(); });
    expect(rail()!.getAttribute("mode")).toBe("catalog");
  });

  it("saves and applies a change at once", () => {
    act(() => { button("Letras derechas").click(); });
    expect(rail()!.getAttribute("orientation")).toBe("stacked");
    expect(loadModeRail().orientation).toBe("stacked");
    act(() => { (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    expect(loadModeRail().enabled).toBe(false);
    expect(rail()).toBeNull();
    expect(document.documentElement.classList.contains("ga-mode-rail-on")).toBe(false);
  });

  it("refuses CSS it cannot read, says why and changes nothing", async () => {
    typeCss(".word {\n  colr red;\n}");
    await apply();
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("No se puede aplicar el estilo.");
    expect(alert.textContent).toContain("línea 2");
    expect(alert.textContent).toContain("colr red");
    expect(loadModeRail().css).toBe("");
    expect(rail()!.hasAttribute("css")).toBe(false);
  });

  it("refuses an unclosed block", async () => {
    typeCss(".word { color: #fff;");
    await apply();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("falta cerrar la llave");
    expect(loadModeRail().css).toBe("");
  });

  it("refuses CSS that hides the rail and puts the previous style back", async () => {
    typeCss(".word { display: none; }");
    await apply();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("la barra deja de verse");
    expect(loadModeRail().css).toBe("");
    expect(rail()!.hasAttribute("css")).toBe(false);
  });

  it("applies and saves CSS that is fine", async () => {
    typeCss(".word { letter-spacing: .04em; }");
    await apply();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')!.textContent).toBe("Estilo aplicado y guardado.");
    expect(loadModeRail().css).toBe(".word { letter-spacing: .04em; }");
    expect(rail()!.getAttribute("css")).toBe(".word { letter-spacing: .04em; }");
  });
});
