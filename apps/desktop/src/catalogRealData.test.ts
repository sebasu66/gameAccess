/**
 * Regression suite against the REAL published catalog.
 *
 * The other filter tests use hand-made fixtures, which cannot notice that the
 * data itself is the problem (a popularity sort that falls back to A-Z because
 * 99% of games lack the field, a genre list that offers `Racing` and `Carreras`
 * as two choices). These checks load the package that ships in the installer and
 * assert quantities, so they fail when a change to the code or to the data
 * quietly makes search, filters or ordering worse. Nobody has to open the app.
 *
 * Needs Node's built-in `node:sqlite` (Node 22.5+); without it the suite is
 * skipped rather than failing a machine that cannot read the package.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { buildLibraryCollection, popularityValue, releaseDateValue, reviewScoreRank } from "./librarySections";
import { filterLibraryGames, getLibrarySearchFacets, gameIsSoftware, gameMatchesLibraryFeature, parseReleaseDate } from "./librarySearch";
import { genreConceptId, genreConceptIds, genreLabel } from "./libraryGenres";
import { loadRealCatalog } from "./catalogFixture";
import type { CatalogGame } from "./types";

let catalog: CatalogGame[] | null = null;
let available = true;
beforeAll(async () => {
  catalog = (await loadRealCatalog())?.games ?? null;
  available = catalog !== null;
}, 60_000);

const games = () => catalog as CatalogGame[];
// The app's own default: games only, nothing else selected.
const noFilters = { genres: [], categories: [], features: [], software: false };
const count = (filters: Partial<Parameters<typeof filterLibraryGames>[2]> = {}, query = "") =>
  filterLibraryGames(games(), query, { ...noFilters, ...filters } as never).length;

describe("real catalog", { timeout: 30_000 }, () => {
  it("loads a catalog of the expected size", ({ skip }) => {
    if (!available) skip();
    expect(games().length).toBeGreaterThan(30_000);
    expect(new Set(games().map(game => game.app_id)).size).toBeGreaterThan(30_000);
  });

  describe("genres", () => {
    it("collapses the dirty genre vocabulary", ({ skip }) => {
      if (!available) skip();
      const raw = new Set(games().flatMap(game => game.genres ?? []));
      const concepts = new Set(games().flatMap(game => genreConceptIds(game.genres)));
      expect(concepts.size).toBeLessThanOrEqual(raw.size);
      expect(concepts.size).toBeLessThanOrEqual(75);
      expect(genreConceptIds(["Racing", "Carreras", "racing ", "RPG", "Role-playing (RPG)", "Rol"])).toEqual(["racing", "rpg"]);
    });

    it("offers every genre once, with a unique label", ({ skip }) => {
      if (!available) skip();
      const facets = getLibrarySearchFacets(games()).genres;
      expect(new Set(facets).size).toBe(facets.length);
      const labels = facets.map(genreLabel).map(label => label.toLowerCase());
      expect(new Set(labels).size).toBe(labels.length);
    });

    it("finds racing games whichever way Steam spelled the genre", ({ skip }) => {
      if (!available) skip();
      const direct = games().filter(game => !gameIsSoftware(game) && (game.genres ?? []).some(value => ["racing", "carreras"].includes(value.trim().toLowerCase()))).length;
      expect(direct).toBeGreaterThan(1000);
      expect(count({ genres: ["racing"] })).toBe(direct);
      // Selecting the Spanish word must give the same list, not the 3 games that happen to use it.
      expect(count({ genres: ["Carreras"] })).toBe(direct);
      expect(genreConceptId("Carreras")).toBe(genreConceptId("Racing"));
    });

    it("returns, for every offered genre, exactly the games that carry it", ({ skip }) => {
      if (!available) skip();
      const facets = getLibrarySearchFacets(games()).genres;
      for (const id of facets.slice(0, 40)) {
        const expected = games().filter(game => !gameIsSoftware(game) && genreConceptIds(game.genres).includes(id)).length;
        expect(count({ genres: [id] }), id).toBe(expected);
        expect(expected, id).toBeGreaterThan(0);
      }
    });

    it("keeps maturity labels out of the genre list", ({ skip }) => {
      if (!available) skip();
      const facets = getLibrarySearchFacets(games()).genres;
      for (const label of ["Violent", "Gore", "Nudity", "Sexual Content"]) expect(facets).not.toContain(genreConceptId(label) ?? label);
    });
  });

  describe("ordering", () => {
    it("has popularity data for nearly the whole catalog, not just the few with recommendations", ({ skip }) => {
      if (!available) skip();
      const withData = games().filter(game => popularityValue(game) > 0).length;
      expect(withData / games().length).toBeGreaterThan(0.85);
    });

    it("sorts by popularity, most popular first, with real popular games on top", ({ skip }) => {
      if (!available) skip();
      const top = buildLibraryCollection(games(), {}, {}, {}, "catalog", "steam-popularity").games.slice(0, 50);
      const values = top.map(popularityValue);
      expect(values).toEqual([...values].sort((a, b) => b - a));
      expect(values[24]).toBeGreaterThan(100_000);
      // Positions 1000-1100 must still be ordered by popularity, not alphabetical.
      const deeper = buildLibraryCollection(games(), {}, {}, {}, "catalog", "steam-popularity").games.slice(1000, 1100).map(popularityValue);
      expect(deeper).toEqual([...deeper].sort((a, b) => b - a));
      expect(deeper[0]).toBeGreaterThan(0);
    });

    it("ranks by review score only among games with enough reviews to trust it", ({ skip }) => {
      if (!available) skip();
      const top = buildLibraryCollection(games(), {}, {}, {}, "catalog", "steam-review-score").games.slice(0, 50);
      for (const game of top) expect(game.steam_review_count ?? 0, game.name).toBeGreaterThanOrEqual(300);
      const ranks = top.map(reviewScoreRank);
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    });

    it("sorts by release date, newest first, unknown dates last", ({ skip }) => {
      if (!available) skip();
      const ordered = buildLibraryCollection(games(), {}, {}, {}, "catalog", "release-date").games;
      const values = ordered.slice(0, 200).map(game => releaseDateValue(game.release_date));
      expect(values).toEqual([...values].sort((a, b) => b - a));
      expect(values[0]).toBeGreaterThan(Date.UTC(2026, 0, 1));
      const firstUnknown = ordered.findIndex(game => releaseDateValue(game.release_date) === 0);
      expect(ordered.slice(firstUnknown).every(game => releaseDateValue(game.release_date) === 0)).toBe(true);
    });

    it("reads every date the catalog actually has", ({ skip }) => {
      if (!available) skip();
      const dated = games().filter(game => (game.release_date ?? "").trim());
      const unreadable = dated.filter(game => parseReleaseDate(game.release_date) === null);
      expect(unreadable.length / dated.length).toBeLessThan(0.01);
    });
  });

  describe("search and filters", () => {
    it("finds a game by name and only returns games that contain the term", ({ skip }) => {
      if (!available) skip();
      const hits = filterLibraryGames(games(), "zelda", noFilters as never);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) expect(`${hit.name} ${(hit.tags ?? []).join(" ")}`.toLowerCase()).toContain("zelda");
    });

    it("ignores accents and case in the query", ({ skip }) => {
      if (!available) skip();
      expect(count({}, "cafe")).toBeGreaterThan(0);
      expect(count({}, "CAFÉ")).toBe(count({}, "cafe"));
    });

    it("keeps the player-mode filters meaningful", ({ skip }) => {
      if (!available) skip();
      expect(count({ features: ["single_player"] })).toBeGreaterThan(5000);
      expect(count({ features: ["multiplayer"] })).toBeGreaterThan(1000);
      expect(count({ features: ["multiplayer", "coop"] })).toBeGreaterThan(500);
      expect(count({ features: ["multiplayer", "pvp"] })).toBeGreaterThan(500);
      expect(count({ features: ["multiplayer", "coop"] })).toBeLessThan(count({ features: ["multiplayer"] }));
    });

    it("combines genre and mode as an intersection", ({ skip }) => {
      if (!available) skip();
      const both = count({ genres: ["racing"], features: ["multiplayer"] });
      expect(both).toBeGreaterThan(0);
      expect(both).toBeLessThan(count({ genres: ["racing"] }));
      expect(both).toBeLessThan(count({ features: ["multiplayer"] }));
    });

    it("applies the score and year bounds without admitting unknowns", ({ skip }) => {
      if (!available) skip();
      const scored = filterLibraryGames(games(), "", { ...noFilters, minReviewScore: 80 } as never);
      expect(scored.length).toBeGreaterThan(1000);
      for (const game of scored.slice(0, 500)) expect(game.steam_review_score ?? -1).toBeGreaterThanOrEqual(80);
      const recent = filterLibraryGames(games(), "", { ...noFilters, releaseYearFrom: 2026 } as never);
      expect(recent.length).toBeGreaterThan(5000);
      for (const game of recent.slice(0, 500)) expect(parseReleaseDate(game.release_date)?.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
    });

    it("keeps software out of a games search and finds it when asked", ({ skip }) => {
      if (!available) skip();
      const software = games().filter(gameIsSoftware).length;
      expect(software).toBeGreaterThan(0);
      expect(software).toBeLessThan(150);
      expect(count({ software: false })).toBe(games().length - software);
      expect(count({ software: true })).toBe(software);
      expect(count({ software: undefined })).toBe(games().length);
    });

    it("filters and sorts the whole catalog fast enough to feel instant", ({ skip }) => {
      if (!available) skip();
      const run = () => {
        const filtered = filterLibraryGames(games(), "a", { ...noFilters, genres: ["action"], features: ["single_player"] } as never);
        buildLibraryCollection(filtered, {}, {}, {}, "catalog", "steam-popularity");
      };
      run(); // First pass builds the per-record evidence caches.
      const started = performance.now();
      run();
      // Measured at ~0.15 s; before the evidence cache a single filter change cost 1-3 s.
      expect(performance.now() - started).toBeLessThan(1500);
    });
  });

  /**
   * Invariants that must hold on ANY catalog revision, so they survive the daily
   * data refresh. They protect the basic behaviour (player modes, quality bounds,
   * text search, orderings) from a future change that breaks it without anyone
   * noticing; the quantity checks above protect against the data degrading.
   */
  describe("regression invariants", () => {
    const run = (filters: object = {}, query = "") =>
      filterLibraryGames(games(), query, { ...noFilters, ...filters } as never);
    const idsOf = (list: CatalogGame[]) => new Set(list.map(game => game.id));

    it("'Solo un jugador' never returns a game that also offers multiplayer", ({ skip }) => {
      if (!available) skip();
      const result = run({ features: ["single_player"] });
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(game => gameMatchesLibraryFeature(game, "multiplayer"))).toBe(false);
    });

    it("multiplayer sub-modes are subsets of multiplayer", ({ skip }) => {
      if (!available) skip();
      const multiplayer = idsOf(run({ features: ["multiplayer"] }));
      for (const mode of ["coop", "pvp", "lan", "online_multiplayer", "shared_split_screen", "mmo"] as const) {
        const withMode = run({ features: ["multiplayer", mode] });
        expect(withMode.length, mode).toBeGreaterThan(0);
        expect(withMode.every(game => multiplayer.has(game.id)), mode).toBe(true);
      }
    });

    it("adding a requirement never adds results", ({ skip }) => {
      if (!available) skip();
      const loose = idsOf(run({ genres: ["action"] }));
      const strict = run({ genres: ["action"], features: ["multiplayer"], minReviewScore: 70 });
      expect(strict.every(game => loose.has(game.id))).toBe(true);
      expect(strict.length).toBeLessThan(loose.size);
    });

    it("excluding a genre removes exactly the games that carry it", ({ skip }) => {
      if (!available) skip();
      const all = count();
      const withGenre = count({ genres: ["rpg"] });
      expect(count({ excludeGenres: ["rpg"] })).toBe(all - withGenre);
    });

    it("quality bounds never admit a game that cannot be measured", ({ skip }) => {
      if (!available) skip();
      expect(run({ minReviewScore: 1 }).every(game => typeof game.steam_review_score === "number")).toBe(true);
      expect(run({ releaseYearFrom: 1990 }).every(game => parseReleaseDate(game.release_date) !== null)).toBe(true);
      expect(count({ minReviewScore: 90 })).toBeLessThan(count({ minReviewScore: 70 }));
    });

    it("text search only returns games that contain every term, and more terms never add results", ({ skip }) => {
      if (!available) skip();
      const one = run({}, "dark");
      const two = run({}, "dark souls");
      expect(two.length).toBeLessThanOrEqual(one.length);
      for (const game of two) expect(`${game.name} ${(game.tags ?? []).join(" ")}`.toLowerCase()).toMatch(/dark[\s\S]*souls|souls[\s\S]*dark/);
    });

    it("search keeps the catalog order, so sorting decides the final order", ({ skip }) => {
      if (!available) skip();
      const position = new Map(games().map((game, index) => [game.id, index]));
      const order = run({}, "the").map(game => position.get(game.id) as number);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it("every sort is a permutation of the same games and is deterministic", ({ skip }) => {
      if (!available) skip();
      const reference = idsOf(games());
      for (const sort of ["name", "steam-popularity", "steam-review-score", "release-date"] as const) {
        const first = buildLibraryCollection(games(), {}, {}, {}, "catalog", sort).games;
        const second = buildLibraryCollection([...games()].reverse(), {}, {}, {}, "catalog", sort).games;
        expect(first.length, sort).toBe(games().length);
        expect(idsOf(first), sort).toEqual(reference);
        // Ties are broken by title and id, so input order cannot change the result.
        expect(second.map(game => game.id), sort).toEqual(first.map(game => game.id));
      }
    });

    it("liked games are never lifted above the chosen sort", ({ skip }) => {
      if (!available) skip();
      const favorites = games().slice(5000, 5003);
      const preferences = Object.fromEntries(favorites.map(game => [game.id, 1 as const]));
      for (const sort of ["name", "steam-popularity", "steam-review-score", "release-date"] as const) {
        const plain = buildLibraryCollection(games(), {}, {}, {}, "catalog", sort).games.map(game => game.id);
        const liked = buildLibraryCollection(games(), {}, preferences, {}, "catalog", sort).games.map(game => game.id);
        expect(liked, sort).toEqual(plain);
      }
    });

    it("the default view never contains a program", ({ skip }) => {
      if (!available) skip();
      expect(run().some(gameIsSoftware)).toBe(false);
    });
  });
});
