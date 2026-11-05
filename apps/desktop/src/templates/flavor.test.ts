// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setStyleFlavor, styleFlavor } from "./flavor";

const css = (name: string) => readFileSync(join(process.cwd(), "src", name), "utf8");
const base = css("templates/base.css"), flavor = css("templates/flavor-terminal.css");
const screens = css("game-info-card.css") + css("plugin-settings.css") + css("ai-settings.css");

describe("capas de estilo", () => {
  it("activa y quita un sabor", () => {
    setStyleFlavor("night");
    expect(document.documentElement.getAttribute("data-ga-flavor")).toBe("night");
    expect(styleFlavor()).toBe("night");
    setStyleFlavor(null);
    expect(styleFlavor()).toBeNull();
  });

  it("la base no tiene colores ni tipografías: eso es del sabor", () => {
    expect(base.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|Manrope|Bebas/i);
  });

  it("cada variable de las piezas nuevas está definida en la base o en el sabor", () => {
    const used = [...screens.matchAll(/var\((--ga-(?:card|tool|tray|light|field-line|field-ink|field-font|t\d)[\w-]*)/g)].map(match => match[1]);
    expect(used.length).toBeGreaterThan(10);
    for (const token of new Set(used)) expect(`${base}${flavor}`).toContain(`${token}:`);
  });

  it("Configuración › IA es capa de pantalla: sin fuentes, colores ni radios a mano", () => {
    const code = css("ai-settings.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/Manrope|Bebas|rgba?\(|#[0-9a-f]{3,8}\b|border-radius: \d/i);
  });

  it("la tarjeta de propiedades no escribe fuentes ni colores propios", () => {
    expect(css("game-info-card.css")).not.toMatch(/Manrope|rgba?\(/);
  });
});
