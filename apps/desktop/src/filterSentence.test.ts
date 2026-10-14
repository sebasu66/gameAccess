import { describe, expect, it } from "vitest";
import { DEFAULT_LIBRARY_FILTERS, type LibrarySearchFilters } from "./librarySearch";
import { buildFilterSentence, sentenceText } from "./filterSentence";

const NOW = 2026;
const sentence = (patch: Partial<LibrarySearchFilters>) =>
  sentenceText(buildFilterSentence({ ...DEFAULT_LIBRARY_FILTERS, minReviewScore: undefined, ...patch } as LibrarySearchFilters, NOW));

describe("filter sentence", () => {
  it("reads as the plain default when nothing is chosen", () => {
    expect(sentence({})).toBe("Quiero encontrar juegos.");
  });

  it("includes the default review bar when it is on", () => {
    expect(sentence({ minReviewScore: 60 })).toBe("Quiero encontrar juegos, con al menos 60 % de reseñas positivas.");
  });

  it("lists included genres with a natural join", () => {
    expect(sentence({ genres: ["action"] })).toBe("Quiero encontrar juegos de Acción.");
    expect(sentence({ genres: ["action", "adventure"] })).toBe("Quiero encontrar juegos de Acción y Aventura.");
    expect(sentence({ genres: ["action", "adventure", "rpg"] })).toBe("Quiero encontrar juegos de Acción, Aventura y RPG.");
  });

  it("says what to leave out", () => {
    expect(sentence({ genres: ["action"], excludeGenres: ["horror"] })).toBe("Quiero encontrar juegos de Acción, pero no de Terror.");
    expect(sentence({ excludeGenres: ["horror"] })).toBe("Quiero encontrar juegos que no sean de Terror.");
  });

  it("describes single player and multiplayer branches", () => {
    expect(sentence({ features: ["single_player"] })).toBe("Quiero encontrar juegos, de un solo jugador.");
    expect(sentence({ features: ["multiplayer"] })).toBe("Quiero encontrar juegos, que admitan multijugador.");
    expect(sentence({ features: ["multiplayer", "coop", "online_multiplayer"] }))
      .toBe("Quiero encontrar juegos, que admitan multijugador (Co-op / PvE y Online).");
  });

  it("describes release years in plain words", () => {
    expect(sentence({ releaseYearFrom: 2024, releaseYearTo: NOW + 1 })).toBe("Quiero encontrar juegos, lanzados en los últimos 2 años.");
    expect(sentence({ releaseYearFrom: 2025, releaseYearTo: NOW + 1 })).toBe("Quiero encontrar juegos, lanzados en el último año.");
    expect(sentence({ releaseYearFrom: 2010, releaseYearTo: NOW + 1 })).toBe("Quiero encontrar juegos, lanzados desde 2010.");
    expect(sentence({ releaseYearFrom: 2010, releaseYearTo: 2015 })).toBe("Quiero encontrar juegos, lanzados entre 2010 y 2015.");
    expect(sentence({ releaseYearFrom: 1995, releaseYearTo: 2000 })).toBe("Quiero encontrar juegos, lanzados hasta 2000.");
  });

  it("mentions programs and sources", () => {
    expect(sentence({ software: true })).toBe("Quiero encontrar programas.");
    expect(sentence({ sources: ["Fuente A", "Fuente B"] })).toBe("Quiero encontrar juegos, con fuente Fuente A o Fuente B.");
    expect(sentence({ excludeSources: ["Fuente C"] })).toBe("Quiero encontrar juegos, sin fuente Fuente C.");
  });

  it("combines everything in one sentence and marks chosen values", () => {
    const parts = buildFilterSentence({
      ...DEFAULT_LIBRARY_FILTERS, genres: ["action"], excludeGenres: ["horror"], features: ["single_player"], minReviewScore: 70,
    } as LibrarySearchFilters, NOW);
    expect(sentenceText(parts)).toBe("Quiero encontrar juegos de Acción, pero no de Terror, de un solo jugador, con al menos 70 % de reseñas positivas.");
    expect(parts.filter(part => part.hl).map(part => part.text)).toEqual(["juegos", "Acción", "Terror", "un solo jugador", "70 %"]);
  });
});
