import { describe, expect, it } from "vitest";
import { DEFAULT_LIBRARY_FILTERS, type LibrarySearchFilters } from "./librarySearch";
import { buildFilterSentence, sentenceText } from "./filterSentence";
import type { AppLocale } from "./i18n";

const NOW = 2026;
const sentenceIn = (locale: AppLocale, patch: Partial<LibrarySearchFilters>) =>
  sentenceText(buildFilterSentence({ ...DEFAULT_LIBRARY_FILTERS, minReviewScore: undefined, maxAgeDays: undefined, ...patch } as LibrarySearchFilters, NOW, locale));
const sentence = (patch: Partial<LibrarySearchFilters>) => sentenceIn("es", patch);
const english = (patch: Partial<LibrarySearchFilters>) => sentenceIn("en", patch);
const DEFAULT_TAIL = "Con cualquier puntaje de reseñas, lanzados en cualquier fecha.";

describe("filter sentence in Spanish", () => {
  it("reads as the permissive default when nothing is chosen", () => {
    expect(sentence({})).toBe(`Quiero encontrar juegos de cualquier género, para cualquier número de jugadores. ${DEFAULT_TAIL}`);
  });

  it("states the review bar", () => {
    expect(sentence({ minReviewScore: 60 })).toContain("Con al menos 60 % de reseñas positivas, lanzados en cualquier fecha.");
  });

  it("adds the review floor to the same clause", () => {
    expect(sentence({ minReviewScore: 60, minReviewCount: 100 })).toContain("Con al menos 60 % de reseñas positivas y 100 reseñas como mínimo, lanzados en cualquier fecha.");
    expect(sentence({ minReviewCount: 100 })).toContain("Con cualquier puntaje de reseñas, pero con 100 reseñas como mínimo, lanzados en cualquier fecha.");
  });

  it("lists included and excluded genres in natural Spanish", () => {
    expect(sentence({ genres: ["action", "adventure"] })).toContain("juegos de Acción y Aventura, para");
    expect(sentence({ genres: ["action"], excludeGenres: ["horror"] })).toContain("juegos de Acción, pero no de Terror, para");
    expect(sentence({ excludeGenres: ["horror"] })).toContain("juegos de cualquier género, pero no de Terror, para");
  });

  it("summarizes many genres instead of listing them", () => {
    expect(sentence({ genres: ["action", "adventure", "rpg", "horror"] })).toContain("juegos de varios géneros, para");
    expect(sentence({ genres: ["action"], excludeGenres: ["horror", "rpg", "adventure", "strategy"] })).toContain("de Acción, pero no de varios géneros, para");
  });

  it("reads the recent-release window in months and years", () => {
    expect(sentence({ maxAgeDays: 90 })).toContain("lanzados en los últimos 3 meses.");
    expect(sentence({ maxAgeDays: 30 })).toContain("lanzados en el último mes.");
    expect(sentence({ maxAgeDays: 365 })).toContain("lanzados en el último año.");
    expect(sentence({ maxAgeDays: 365 * 5 })).toContain("lanzados en los últimos 5 años.");
  });

  it("describes single player and multiplayer", () => {
    expect(sentence({ features: ["single_player"] })).toContain("para un solo jugador.");
    expect(sentence({ features: ["multiplayer"] })).toContain("para multijugador.");
    expect(sentence({ features: ["multiplayer", "coop", "online_multiplayer"] })).toContain("para multijugador (cooperativo y online).");
  });

  it("describes release years in plain words", () => {
    expect(sentence({ releaseYearFrom: 2024, releaseYearTo: NOW + 1 })).toContain("lanzados en los últimos 2 años.");
    expect(sentence({ releaseYearFrom: 2025, releaseYearTo: NOW + 1 })).toContain("lanzados en el último año.");
    expect(sentence({ releaseYearFrom: 2010, releaseYearTo: NOW + 1 })).toContain("lanzados desde 2010.");
    expect(sentence({ releaseYearFrom: 2010, releaseYearTo: 2015 })).toContain("lanzados entre 2010 y 2015.");
    expect(sentence({ releaseYearFrom: 1995, releaseYearTo: 2000 })).toContain("lanzados hasta 2000.");
  });

  it("marks only the changeable terms as clickable", () => {
    const [line1, line2] = buildFilterSentence({
      ...DEFAULT_LIBRARY_FILTERS, genres: ["action"], excludeGenres: ["horror"], features: ["single_player"], minReviewScore: 70,
    } as LibrarySearchFilters, NOW, "es");
    expect(line1.filter(part => part.slot).map(part => part.text)).toEqual(["Acción", "Terror", "un solo jugador"]);
    expect(line2.filter(part => part.slot).map(part => part.text)).toEqual(["70 %", "en cualquier fecha"]);
  });
});

describe("filter sentence in English", () => {
  it("reads as the permissive default when nothing is chosen", () => {
    expect(english({})).toBe("I want to find games in any genre, for any number of players. With any review score, released at any time.");
  });

  it("states the review bar and floor", () => {
    expect(english({ minReviewScore: 60 })).toContain("With at least 60% positive reviews, released at any time.");
    expect(english({ minReviewScore: 60, minReviewCount: 100 })).toContain("With at least 60% positive reviews and at least 100 reviews, released");
    expect(english({ minReviewCount: 100 })).toContain("With any review score, but at least 100 reviews, released");
  });

  it("lists genres with and / or", () => {
    expect(english({ genres: ["action", "adventure", "rpg"] })).toMatch(/games in \S+, \S+ and \S+, for/);
    expect(english({ genres: ["action"], excludeGenres: ["horror", "rpg"] })).toMatch(/, but not in \S+ or \S+, for/);
    expect(english({ genres: ["action", "adventure", "rpg", "horror"] })).toContain("games in several genres, for");
  });

  it("describes players", () => {
    expect(english({ features: ["single_player"] })).toContain("for a single player.");
    expect(english({ features: ["multiplayer", "coop", "online_multiplayer"] })).toContain("for multiplayer (co-op and online).");
  });

  it("describes release windows", () => {
    expect(english({ maxAgeDays: 90 })).toContain("released in the last 3 months.");
    expect(english({ maxAgeDays: 30 })).toContain("released in the last month.");
    expect(english({ releaseYearFrom: 2025, releaseYearTo: NOW + 1 })).toContain("released in the last year.");
    expect(english({ releaseYearFrom: 2024, releaseYearTo: NOW + 1 })).toContain("released in the last 2 years.");
    expect(english({ releaseYearFrom: 2010, releaseYearTo: NOW + 1 })).toContain("released since 2010.");
    expect(english({ releaseYearFrom: 2010, releaseYearTo: 2015 })).toContain("released between 2010 and 2015.");
    expect(english({ releaseYearFrom: 1995, releaseYearTo: 2000 })).toContain("released up to 2000.");
  });

  it("keeps the same clickable slots", () => {
    const [line1, line2] = buildFilterSentence({
      ...DEFAULT_LIBRARY_FILTERS, features: ["single_player"], minReviewScore: 70,
    } as LibrarySearchFilters, NOW, "en");
    expect(line1.filter(part => part.slot).map(part => part.text)).toEqual(["any genre", "a single player"]);
    expect(line2.filter(part => part.slot).map(part => part.text)).toEqual(["70%", "at any time"]);
  });
});
