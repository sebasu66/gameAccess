import { describe, expect, it } from "vitest";
import { en } from "../locales/en";
import { es } from "../locales/es";
import { LEGACY_DESTINATIONS, NAVIGATION } from "./navigationTree";

describe("árbol de navegación", () => {
  it("ordena los cuatro modos y conserva todas sus secciones", () => {
    expect(NAVIGATION.map(mode => mode.id)).toEqual(["catalog", "library", "gameAccess", "settings"]);
    expect(NAVIGATION.map(mode => mode.sections.map(section => section.id))).toEqual([
      ["explore", "smartSearch", "aiSuggestions", "newGames", "tasteProfile"],
      ["play", "downloads", "manager"],
      ["news", "support", "subscription"],
      ["general", "appearance", "plugins", "parental"],
    ]);
  });

  it("ubica descargas, manager y control parental bajo los modos nuevos", () => {
    expect(LEGACY_DESTINATIONS.library.downloads).toBe("downloads");
    expect(LEGACY_DESTINATIONS.library.manager).toBe("manager");
    expect(LEGACY_DESTINATIONS.settings.parental).toBe("kids");
    for (const mode of NAVIGATION) {
      expect(Object.keys(LEGACY_DESTINATIONS[mode.id])).toEqual(mode.sections.map(section => section.id));
    }
  });

  it("cada nombre visible tiene traducción en español e inglés", () => {
    const keys = NAVIGATION.flatMap(mode => [mode.label, ...mode.sections.flatMap(section => [section.label, ...section.tabs.map(tab => tab.label)])]);
    for (const key of keys) {
      expect(es[key]?.trim()).toBeTruthy();
      expect(en[key]?.trim()).toBeTruthy();
    }
  });
});
