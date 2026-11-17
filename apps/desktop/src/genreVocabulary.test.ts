import { afterEach, describe, expect, it, vi } from "vitest";
import table from "./genreConcepts.json";
import { loadAiProfile, saveAiProfile, describeProfile, EMPTY_PROFILE } from "./aiProfile";
import { setAppLocale, translate, type TranslationKey } from "./i18n";
import { genreConceptId, genreLabel, genreLabels, genreStoredName, offeredGenres } from "./libraryGenres";

const stored = new Map<string, string>();
const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key), clear: () => stored.clear() };
vi.stubGlobal("localStorage", storage);
vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: storage }));

describe("the genre vocabulary", () => {
  afterEach(() => { setAppLocale("es"); localStorage.clear(); });

  it("every concept has its name in both languages", () => {
    for (const concept of table.concepts) {
      for (const locale of ["es", "en"] as const) expect(translate(`genre_${concept.id}` as TranslationKey, undefined, locale), concept.id).not.toMatch(/^genre_/);
    }
  });

  it("shows a genre in the app's language, whatever language it was stored in", () => {
    setAppLocale("en");
    expect(genreLabels(["Carreras", "Action"])).toEqual(["Racing", "Action"]);
    setAppLocale("es");
    expect(genreLabels(["Racing", "Acción"])).toEqual(["Carreras", "Acción"]);
  });

  it("spellings of one concept are one entry", () => {
    expect(genreConceptId("JRPG")).toBe("rpg");
    expect(genreLabels(["Racing", "Carreras", "Off-road"])).toHaveLength(1);
  });

  it("content warnings, perspectives and settings are not genres", () => {
    for (const value of ["Violencia", "Sangrientos", "Contenido sexual", "FPP", "Turn-based", "Comedy"]) expect(genreConceptId(value)).toBeNull();
  });

  it("offers only known game genres, once, in alphabetical order", () => {
    expect(offeredGenres(["Sports", "Carreras", "Racing", "Algo raro", "Photo Editing", "Violencia", "Action"])).toEqual(["action", "racing", "sports"]);
  });

  it("the AI is told the stored name in any language", () => {
    setAppLocale("es");
    expect(genreStoredName("racing")).toBe("Racing");
    expect(describeProfile({ ...EMPTY_PROFILE, genres: { racing: 1 } }).join()).toContain("Racing");
    expect(genreLabel("racing")).toBe("Carreras");
  });

  it("a saved profile moves to the current concepts", () => {
    saveAiProfile({ ...EMPTY_PROFILE, genres: { jrpg: 1, carreras: -1, violencia: 1 } as never });
    expect(loadAiProfile().genres).toEqual({ rpg: 1, racing: -1 });
  });
});
