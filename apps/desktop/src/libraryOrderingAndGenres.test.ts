import { describe, expect, it } from "vitest";
import { buildLibraryCollection, buildLibrarySections, popularityValue, releaseDateValue, reviewScoreRank } from "./librarySections";
import { readFileSync } from "node:fs";
import { canonicalGenres, genreConceptId, genreConceptIds, genreLabel } from "./libraryGenres";
import { filterLibraryGames, gameGenres, gameIsSoftware, getLibrarySearchFacets, parseReleaseDate } from "./librarySearch";
import type { CatalogGame } from "./types";

const game = (id: number, extra: Partial<CatalogGame> = {}) => ({ id, app_id: id, name: `Game ${String(id).padStart(3, "0")}`, ...extra }) as CatalogGame;
const ids = (games: CatalogGame[]) => games.map(entry => entry.id);

describe("popularity", () => {
  it("falls back to the review count when Steam gave no recommendation count", () => {
    // The published catalog has recommendation_count for 0.6% of games and
    // steam_review_count for ~90%; sorting on the first alone left the rest A-Z.
    const games = [
      game(1, { name: "Alpha" }),
      game(2, { name: "Beta", steam_review_count: 50_000 }),
      game(3, { name: "Gamma", steam_review_count: 900 }),
      game(4, { name: "Delta", recommendation_count: 20_000, steam_review_count: 25_000 }),
    ];
    expect(ids(buildLibraryCollection(games, {}, {}, {}, "catalog", "steam-popularity").games)).toEqual([2, 4, 3, 1]);
    expect(popularityValue(games[0])).toBe(0);
    expect(popularityValue(games[3])).toBe(20_000);
  });
  it("still sorts by title when no game has any popularity data", () => {
    const games = [game(2, { name: "Zeta" }), game(1, { name: "Alfa" })];
    const collection = buildLibraryCollection(games, {}, {}, {}, "catalog", "steam-popularity");
    expect(ids(collection.games)).toEqual([1, 2]);
    expect(collection.description).toContain("se ordenan por título");
  });
  it("orders the catalog section with the same comparator", () => {
    const games = [game(1), game(2, { steam_review_count: 10 }), game(3, { steam_review_count: 99 })];
    const catalog = buildLibrarySections(games, {}, {}, {}, "steam-popularity").find(section => section.id === "catalog");
    expect(ids(catalog?.games ?? [])).toEqual([3, 2, 1]);
  });
});

describe("review score ranking", () => {
  it("does not let a handful of reviews outrank thousands", () => {
    const tiny = game(1, { name: "Tiny", steam_review_score: 100, steam_review_count: 3 });
    const big = game(2, { name: "Big", steam_review_score: 95, steam_review_count: 50_000 });
    expect(ids(buildLibraryCollection([tiny, big], {}, {}, {}, "catalog", "steam-review-score").games)).toEqual([2, 1]);
    expect(reviewScoreRank(big)).toBeGreaterThan(reviewScoreRank(tiny));
  });
  it("keeps a real score near itself once the review count is large", () => {
    expect(reviewScoreRank(game(1, { steam_review_score: 90, steam_review_count: 100_000 }))).toBeCloseTo(90, 1);
  });
  it("ranks games without a usable score last", () => {
    expect(reviewScoreRank(game(1, { steam_review_score: 100, steam_review_count: 0 }))).toBe(-1);
    expect(reviewScoreRank(game(2, { steam_review_score: null, steam_review_count: 40 }))).toBe(-1);
    const rated = game(3, { steam_review_score: 40, steam_review_count: 500 });
    const unrated = game(4, { name: "A first", steam_review_score: 100, steam_review_count: 0 });
    expect(ids(buildLibraryCollection([unrated, rated], {}, {}, {}, "catalog", "steam-review-score").games)).toEqual([3, 4]);
  });
});

describe("release dates share one parser", () => {
  const cases: [string, string | null][] = [
    ["2009-05-14", "2009-05-14"],
    ["12 AGO 2016", "2016-08-12"],
    ["9 DIC 2020", "2020-12-09"],
    ["1 de abril de 2024", "2024-04-01"],
    ["12 Aug, 2026", "2026-08-12"],
    ["Aug 12, 2026", "2026-08-12"],
    ["15 SEPT 2021", "2021-09-15"],
    ["31 FEB 2024", null],
    ["2024-02-31", null],
    ["2024-13-01", null],
    ["Próximamente", null],
    ["Q1 2027", null],
    ["", null],
  ];
  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)}`, () => {
      expect(parseReleaseDate(input)?.toISOString().slice(0, 10) ?? null).toBe(expected);
      // The sort key and the year filter can never disagree about readability.
      expect(releaseDateValue(input) !== 0).toBe(expected !== null);
    });
  }
  it("sorts unknown dates after every known one, never as old releases", () => {
    const games = [game(1, { release_date: null }), game(2, { release_date: "12 AGO 2016" }), game(3, { release_date: "2025-01-01" }), game(4, { release_date: "Próximamente" })];
    expect(ids(buildLibraryCollection(games, {}, {}, {}, "catalog", "release-date").games)).toEqual([3, 2, 1, 4]);
  });
  it("reads the year range through the same parser", () => {
    const games = [game(1, { release_date: "1 de abril de 2024" }), game(2, { release_date: "12 Aug, 2016" }), game(3, { release_date: "Próximamente" })];
    const filters = { genres: [], categories: [], features: [], software: undefined, releaseYearFrom: 2020 };
    expect(ids(filterLibraryGames(games, "", filters))).toEqual([1]);
  });
});

describe("genre concepts", () => {
  it("collapses spelling and language variants into one concept", () => {
    expect(genreConceptIds(["Free To Play", "Free to Play", "Sport", "Sports", "Deportes"])).toEqual(["free_to_play", "sports"]);
    expect(genreConceptIds(["RPG", "Role-playing (RPG)", "Role-playing", "Rol"])).toEqual(["rpg"]);
    expect(genreConceptIds(["Simulation", "Simulator", "Simuladores", "Simulación"])).toEqual(["simulation"]);
    expect(genreConceptIds(["Acción", "Aventura", "Estrategia", "Carreras"])).toEqual(["action", "adventure", "strategy", "racing"]);
  });
  it("maps Racing and Carreras to the same concept, which is the case that motivated this", () => {
    expect(genreConceptId("Racing")).toBe("racing");
    expect(genreConceptId("Carreras")).toBe("racing");
    expect(genreConceptId("carreras ")).toBe("racing");
    expect(genreLabel("racing")).toBe("Carreras");
    const games = [game(1, { genres: ["Racing", "Indie"] }), game(2, { genres: ["Carreras"] }), game(3, { genres: ["Racing"] }), game(4, { genres: ["Action"] })];
    const facets = getLibrarySearchFacets(games).genres;
    expect(facets.filter(id => id === "racing")).toHaveLength(1);
    expect(ids(filterLibraryGames(games, "", { genres: ["racing"], categories: [], features: [] }))).toEqual([1, 2, 3]);
    // The same search selected under either old spelling finds the same games.
    expect(ids(filterLibraryGames(games, "", { genres: ["Carreras"], categories: [], features: [] }))).toEqual([1, 2, 3]);
    expect(ids(filterLibraryGames(games, "", { genres: ["Racing"], categories: [], features: [] }))).toEqual([1, 2, 3]);
  });
  it("drops maturity labels, and keeps an unknown genre as its own concept with its own text", () => {
    expect(genreConceptId("Violent")).toBeNull();
    expect(genreConceptId("Sexual Content")).toBeNull();
    expect(genreConceptId("")).toBeNull();
    expect(genreConceptIds(["Gore", "Nudity", "Metroidvania", "  Fantasy "])).toEqual(["metroidvania", "fantasy"]);
    expect(genreLabel("metroidvania")).toBe("Metroidvania");
    expect(genreConceptIds(undefined)).toEqual([]);
  });
  it("keeps Steam's English spelling available for the published catalog", () => {
    expect(canonicalGenres(["Carreras", "Racing", "Violent", "Rol"])).toEqual(["Racing", "RPG"]);
  });
  it("offers each genre once in the filter panel, in Spanish label order", () => {
    const games = [
      game(1, { genres: ["Free To Play", "RPG"] }),
      game(2, { genres: ["Free to Play", "Role-playing (RPG)", "Violent"] }),
      game(3, { genres: ["Deportes", "Sport"] }),
    ];
    expect(getLibrarySearchFacets(games).genres).toEqual(["sports", "free_to_play", "rpg"]);
    expect(["sports", "free_to_play", "rpg"].map(genreLabel)).toEqual(["Deportes", "Gratuito", "RPG"]);
  });
  it("matches and excludes by concept whichever spelling the data or the saved filter uses", () => {
    const games = [game(1, { genres: ["Role-playing (RPG)"] }), game(2, { genres: ["Rol"] }), game(3, { genres: ["Racing"] })];
    const filters = (genres: string[]) => ({ genres, categories: [], features: [] as never[], software: undefined });
    expect(ids(filterLibraryGames(games, "", filters(["rpg"])))).toEqual([1, 2]);
    expect(ids(filterLibraryGames(games, "", filters(["Role-playing"])))).toEqual([1, 2]);
    expect(ids(filterLibraryGames(games, "", { ...filters([]), excludeGenres: ["RPG"] }))).toEqual([3]);
  });
  it("does not turn genres into free text search", () => {
    expect(filterLibraryGames([game(1, { name: "Forza", genres: ["Racing"] })], "carreras")).toEqual([]);
  });
  it("recognizes software in English and Spanish spellings", () => {
    expect(gameIsSoftware(game(1, { genres: ["Utilities"] }))).toBe(true);
    expect(gameIsSoftware(game(2, { genres: ["Utilidades"] }))).toBe(true);
    expect(gameIsSoftware(game(3, { genres: ["Animation & Modeling", "Video Production"] }))).toBe(true);
    expect(gameIsSoftware(game(4, { genres: ["Action", "Indie"] }))).toBe(false);
    expect(gameGenres(game(5, { genres: ["Utilities", "Action"] }))).toEqual(["action"]);
  });
  it("keeps the client and pipeline concept tables identical", () => {
    const client = readFileSync(new URL("./genreConcepts.json", import.meta.url), "utf8");
    const pipeline = readFileSync(new URL("../../api/app/genre_concepts.json", import.meta.url), "utf8");
    expect(pipeline).toBe(client);
  });
});
