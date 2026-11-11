// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sectionListOrder } from "./navigationSelection";
import { applyShellLook, clearShellLook, DEFAULT_SHELL_LOOK, loadShellLook, normalizeShellLook, saveShellLook, SHELL_PARAMS, shellLookVariables } from "./shellLook";

const css = (name: string) => readFileSync(join(process.cwd(), "src", name), "utf8");

afterEach(() => { clearShellLook(); localStorage.clear(); });

describe("look del marco nuevo (Configuración › Apariencia)", () => {
  it("cada valor editable es una variable que definen las plantillas", () => {
    const templates = css("templates/base.css") + css("templates/flavor-1.css") + css("templates/flavor-terminal.css");
    for (const param of SHELL_PARAMS) expect(templates).toContain(`${param.cssVar}:`);
  });

  it("los valores fuera de rango se acotan y lo desconocido se descarta", () => {
    const look = normalizeShellLook({ style: 7, values: { modeWidth: 999, railGraphic: "metal", iconFill: "neon" }, word: { orientation: "sideways", start: "decode", size: 10 } });
    expect(look.style).toBe(1);
    expect(look.values).toEqual({ modeWidth: 180, iconFill: "neon" });
    expect(look.word).toMatchObject({ orientation: "up", start: "decode", size: 40 });
  });

  it("aplica el estilo y escribe solo lo cambiado; lo que se vuelve a fábrica se quita", () => {
    const root = document.documentElement;
    applyShellLook({ ...DEFAULT_SHELL_LOOK, style: 3, values: { bandSlant: 12, railGraphic: "dots" }, word: { ...DEFAULT_SHELL_LOOK.word, font: "Teko", tracking: .1 } });
    expect(root.dataset.gaFlavor).toBe("estilo-3");
    expect(root.style.getPropertyValue("--ga-nav-mode-slant")).toBe("12px");
    expect(root.style.getPropertyValue("--ga-nav-rail-graphic")).toBe("dots");
    expect(root.style.getPropertyValue("--ga-nav-word-tracking")).toBe("0.1em");
    applyShellLook({ ...DEFAULT_SHELL_LOOK, style: 2 });
    expect(root.dataset.gaFlavor).toBe("estilo-2");
    expect(root.style.getPropertyValue("--ga-nav-mode-slant")).toBe("");
    expect(root.style.getPropertyValue("--ga-nav-word-family")).toBe("");
  });

  it("se guarda y se vuelve a leer igual", () => {
    const saved = saveShellLook({ ...DEFAULT_SHELL_LOOK, style: 4, values: { glow: .2 }, word: { ...DEFAULT_SHELL_LOOK.word, orientation: "stacked", end: "fade" } });
    expect(loadShellLook()).toEqual(saved);
    expect(shellLookVariables(saved)).toEqual({ "--ga-nav-glow": "0.2" });
  });
});

describe("orden de las secciones en el panel (§4.2)", () => {
  const all = ["a", "b", "c", "d"];
  it("la elegida sale de la lista y la anterior vuelve al lugar que dejó", () => {
    const first = sectionListOrder(all, "a");
    expect(first).toEqual(["b", "c", "d"]);
    const second = sectionListOrder(all, "c", first);
    expect(second).toEqual(["b", "a", "d"]);
    expect(sectionListOrder(all, "c", second)).toEqual(["b", "a", "d"]);
  });
});
