// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { NAVIGATION } from "./navigationTree";
import { filterBlocks, GAME_SEARCH_SECTIONS, headerKind, PAGE_SEARCH_SECTIONS } from "./headerSlot";

describe("cabecera del contenido (§4.3)", () => {
  it("buscan Explorar, Juegos nuevos, Jugar, Manager, Ayuda y toda Configuración; las demás muestran un resumen", () => {
    const sections = NAVIGATION.flatMap(mode => mode.sections.map(section => section.id as string));
    for (const id of [...GAME_SEARCH_SECTIONS, ...PAGE_SEARCH_SECTIONS]) expect(sections).toContain(id);
    expect(headerKind("play")).toBe("games");
    expect(headerKind("appearance")).toBe("page");
    expect(headerKind("downloads")).toBe("summary");
    const settings = NAVIGATION.find(mode => mode.id === "settings")!.sections.map(section => section.id as string);
    for (const id of settings) expect(headerKind(id)).toBe("page");
  });

  it("la búsqueda en pantalla deja solo los bloques con todas las palabras, sin mirar tildes ni mayúsculas", () => {
    document.body.innerHTML = `<section>
      <fieldset><legend>Palabra</legend><div class="ga-rail-field">Animación al entrar</div><div class="ga-rail-field">Fuente</div></fieldset>
      <details class="ga-help-topic"><summary>Descargas</summary>Cómo bajar</details></section>`;
    const root = document.body.firstElementChild!;
    expect(filterBlocks(root, "ANIMACION entrar")).toBe(2);
    const hidden = [...root.querySelectorAll(".ga-nav-filtered")].map(el => el.textContent?.trim().slice(0, 9));
    expect(hidden).toEqual(["Fuente", "Descargas"]);
    expect(filterBlocks(root, "bajar")).toBe(1);
    expect(root.querySelector("details")!.open).toBe(true);
    expect(filterBlocks(root, "")).toBe(4);
    expect(root.querySelectorAll(".ga-nav-filtered")).toHaveLength(0);
  });
});
