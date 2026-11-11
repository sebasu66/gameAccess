// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { numberedStyleFlavors, setStyleFlavor, styleFlavor } from "./flavor";

const css = (name: string) => readFileSync(join(process.cwd(), "src", name), "utf8");
const base = css("templates/base.css"), flavor = css("templates/flavor-terminal.css");
const screens = css("game-info-card.css") + css("plugin-settings.css") + css("plugin-files.css") + css("ai-settings.css") + css("mcp-settings.css") + css("activity/activity.css") + css("components/ga/smoke.css") + css("big-play-confirm.css") + css("big-picture-browse.css");

describe("capas de estilo", () => {
  it("activa y quita un sabor", () => {
    setStyleFlavor("night");
    expect(document.documentElement.getAttribute("data-ga-flavor")).toBe("night");
    expect(styleFlavor()).toBe("night");
    setStyleFlavor(null);
    expect(styleFlavor()).toBeNull();
  });

  it("los cuatro estilos están disponibles sin conexión y tienen los mismos roles visuales", () => {
    const roles = ["display-family", "display-style", "display-case", "button-cut", "panel-corner", "button-radius", "button-fill", "icon-fill", "rail-graphic", "glow", "scan-opacity", "grain-opacity", "transition-time"];
    const main = css("main.tsx");
    for (const [index, name] of numberedStyleFlavors.entries()) {
      const sheet = css(`templates/flavor-${index + 1}.css`);
      expect(main).toContain(`./templates/flavor-${index + 1}.css`);
      expect(sheet).toContain(`:root[data-ga-flavor="${name}"]`);
      for (const role of roles) expect(sheet).toContain(`--ga-nav-${role}:`);
      setStyleFlavor(name);
      expect(styleFlavor()).toBe(name);
    }
    for (const font of ["Teko[wght].ttf", "SairaCondensed-SemiBold.ttf", "BarlowCondensed-BoldItalic.ttf"])
      expect(existsSync(join(process.cwd(), "public", "fonts", font))).toBe(true);
    setStyleFlavor(null);
  });

  it("la estructura del nuevo marco vive en la base y no en los sabores", () => {
    const roles = ["mode-w", "sections-w", "activity-w", "outer-pad", "column-gap", "status-h", "content-pad", "section-pad", "card-pad", "section-gap", "action-gap"];
    for (const role of roles) {
      expect(base).toContain(`--ga-nav-${role}:`);
      for (let index = 1; index <= 4; index++) expect(css(`templates/flavor-${index}.css`)).not.toContain(`--ga-nav-${role}:`);
    }
  });

  it("la base no tiene colores ni tipografías: eso es del sabor", () => {
    expect(base.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|Manrope|Bebas/i);
  });

  it("cada variable de las piezas nuevas está definida en la base o en el sabor", () => {
    const used = [...screens.matchAll(/var\((--ga-(?:card|tool|tray|light|feed|files|kind|field-line|field-ink|field-font|t\d)[\w-]*)/g)].map(match => match[1]);
    expect(used.length).toBeGreaterThan(10);
    for (const token of new Set(used)) expect(`${base}${flavor}`).toContain(`${token}:`);
  });

  it("Configuración › IA es capa de pantalla: sin fuentes, colores ni radios a mano", () => {
    const code = css("ai-settings.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/Manrope|Bebas|rgba?\(|#[0-9a-f]{3,8}\b|border-radius: \d/i);
  });

  it("Configuración › Control por IA es capa de pantalla: sin fuentes, colores, radios ni medidas a mano", () => {
    const code = css("mcp-settings.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/Manrope|Bebas|rgba?\(|#[0-9a-f]{3,8}|border-radius|font-size|font: \d|(?<![\d.])\d+px/i);
  });

  it("Actividad es capa de pantalla: sin fuentes, colores ni radios a mano", () => {
    const code = css("activity/activity.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/Manrope|Bebas|rgba?\(|#[0-9a-f]{3,8}\b|border-radius: \d+px|font: \d/i);
  });

  it("la capa de humo y la pregunta de Big Picture no escriben valores a mano", () => {
    const code = (css("components/ga/smoke.css") + css("big-play-confirm.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/Manrope|Bebas|rgba?\(|#[0-9a-f]{3,8}\b|border-radius: \d|font-size: \d/i);
  });

  it("la búsqueda, el riel y la salida de Big Picture son capa de pantalla: sin valores a mano", () => {
    const code = css("big-picture-browse.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/Manrope|Bebas|rgba?\(|#[0-9a-f]{3,8}|border-radius: \d|font-size|font: \d|(?<![\d.])(?:[02-9]|\d{2,})px/i);
  });

  it("los archivos de un resultado (Configuración › Plugins) son capa de pantalla: sin valores a mano", () => {
    const code = css("plugin-files.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/Manrope|Bebas|rgba?\(|#[0-9a-f]{3,8}\b|border-radius|font-size|font: \d|(?<![\d.])(?:[02-9]|\d{2,})px/i);
  });

  it("la tarjeta de propiedades no escribe fuentes ni colores propios", () => {
    expect(css("game-info-card.css")).not.toMatch(/Manrope|rgba?\(/);
  });
});
