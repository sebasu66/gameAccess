import { beforeEach, describe, expect, it } from "vitest";
import { NAVIGATION } from "./navigationTree";
import { getNavigationSelection, newsDestination, resetNavigationSelection, sectionTab, selectNavigationSection, selectNavigationTab, settingsTabIds, shellMode } from "./navigationSelection";

beforeEach(resetNavigationSelection);

describe("selección del nuevo panel", () => {
  it("acepta secciones reales y rechaza destinos ajenos al modo", () => {
    expect(selectNavigationSection("gameAccess", "account")).toBe(true);
    expect(getNavigationSelection().gameAccess).toBe("account");
    expect(selectNavigationSection("gameAccess", "downloads")).toBe(false);
    expect(getNavigationSelection().gameAccess).toBe("account");
  });

  it("Sugerencias IA y Juegos nuevos se ven en Inicio como Catálogo; Game Access lo recupera", () => {
    expect(shellMode("home", undefined, getNavigationSelection().homeMode)).toBe("gameAccess");
    selectNavigationSection("catalog", "newGames");
    expect(shellMode("home", undefined, getNavigationSelection().homeMode)).toBe("catalog");
    // Explore is the games' grid: it does not change what Home hosts.
    selectNavigationSection("catalog", "explore");
    expect(getNavigationSelection().homeMode).toBe("catalog");
    selectNavigationSection("gameAccess", "news");
    expect(shellMode("home", undefined, getNavigationSelection().homeMode)).toBe("gameAccess");
  });

  it("el modo sale de la pantalla: Control parental es Configuración, los juegos dicen su área", () => {
    expect(shellMode("kids", undefined, "gameAccess")).toBe("settings");
    expect(shellMode("settings", undefined, "catalog")).toBe("settings");
    expect(shellMode("downloads", "library", "gameAccess")).toBe("library");
    expect(shellMode("games", undefined, "gameAccess")).toBe("catalog");
  });

  it("una tanda de descargas nuevas abre Catálogo › Juegos nuevos; un anuncio, Game Access › Novedades", () => {
    expect(newsDestination("downloads-1794410469335")).toEqual({ mode: "catalog", section: "newGames" });
    expect(newsDestination("release-2026-11")).toEqual({ mode: "gameAccess", section: "news" });
  });

  it("Configuración: idioma e inicio (Opciones) en General, Estilo y Detalles en Apariencia, nada repetido ni perdido", () => {
    expect(settingsTabIds("general")).toEqual(["games", "steam", "ai", "mcp", "options"]);
    expect(settingsTabIds("appearance")).toEqual(["style", "details"]);
    const settings = NAVIGATION.find(mode => mode.id === "settings")!;
    const all = settings.sections.flatMap(section => settingsTabIds(section.id));
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(["ai", "details", "games", "mcp", "options", "plugins", "steam", "style"]);
  });
});

describe("submodos de cada sección", () => {
  it("cada sección muestra su primer submodo listo y solo cambia a uno que exista y esté listo", () => {
    expect(sectionTab("downloads")).toBe("active");
    expect(selectNavigationTab("library", "downloads", "queued")).toBe(true);
    expect(sectionTab("downloads", getNavigationSelection().tabs)).toBe("queued");
    expect(selectNavigationTab("library", "play", "genres")).toBe(false);
    expect(selectNavigationTab("library", "downloads", "nada")).toBe(false);
    expect(sectionTab("play", getNavigationSelection().tabs)).toBe("recent");
  });
});
