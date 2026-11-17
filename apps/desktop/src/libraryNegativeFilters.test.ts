/**
 * Every filter group works in both directions.
 *
 * Positive criteria are a search ("show me adventure"). Negative criteria are a
 * screen ("but not role-playing"). The rule that keeps this honest is that a
 * negative never fires on missing metadata: absence of evidence is not evidence
 * that the game has the feature.
 *
 * Tags are deliberately NOT a filter group. A community tag is user opinion and
 * unreliable in both directions — filtering by tag put `Blender` and `5D Chess`
 * in a sexual-content result — so tags are search material and content groups
 * filter on Valve's descriptors instead. These tests therefore exercise the
 * tri-state pattern on genres and capabilities, which are the groups that have
 * directions.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_FILTERS,
  filterLibraryGames,
  gameMatchesTags,
  type LibraryFeatureKey,
  type LibrarySearchFilters,
} from "./librarySearch";
import type { CatalogGame } from "./types";

function game(overrides: Partial<CatalogGame>): CatalogGame {
  return {
    id: 1, slug: "g", name: "Game", app_id: 1,
    credit_cost_per_month: 0, copies_total: 1, copies_available: 1,
    ...overrides,
  } as CatalogGame;
}

const filters = (extra: Partial<LibrarySearchFilters>): LibrarySearchFilters => ({ ...DEFAULT_LIBRARY_FILTERS, ...extra });

const catalogue = [
  game({ id: 1, name: "Adventure", genres: ["Adventure"], tags: ["Indie"] }),
  game({ id: 2, name: "Adventure RPG", genres: ["Adventure", "RPG"], tags: ["Indie", "RPG"] }),
  game({ id: 3, name: "RPG only", genres: ["RPG"], tags: ["RPG"] }),
  game({ id: 4, name: "No genre data", genres: [], tags: [] }),
];

describe("community tags are search material, not criteria", () => {
  it("still matches tags for text search and detail enrichment", () => {
    // Kept working on purpose: the detail view and free-text search use them.
    expect(gameMatchesTags(catalogue[0], ["Indie"])).toBe(true);
    expect(gameMatchesTags(catalogue[0], ["RPG"])).toBe(false);
    expect(gameMatchesTags(catalogue[1], ["indie"])).toBe(true);
  });

  it("does not accept tags as a filter field", () => {
    // The type has no tag criteria, so a caller cannot express "only tagged
    // Co-op" and quietly get an unreliable result set.
    const keys = Object.keys(DEFAULT_LIBRARY_FILTERS);
    expect(keys).not.toContain("tags");
    expect(keys).not.toContain("includeTags");
    expect(keys).not.toContain("excludeTags");
  });
});

describe("genre criteria are tri-state", () => {
  it("keeps positive and negative independent", () => {
    const only = filters({ genres: ["Adventure"] });
    expect(filterLibraryGames(catalogue, "", only).map(g => g.id)).toEqual([1, 2]);

    // A negative screen only fires on games that actually carry the genre, so a
    // record with no genre data is kept: absence of evidence is not evidence.
    const without = filters({ excludeGenres: ["RPG"] });
    expect(filterLibraryGames(catalogue, "", without).map(g => g.id)).toEqual([1, 4]);
  });

  it("applies positive first, then negative", () => {
    // "adventure but not role-playing": both directions at once.
    const both = filters({ genres: ["Adventure"], excludeGenres: ["RPG"] });
    expect(filterLibraryGames(catalogue, "", both).map(g => g.id)).toEqual([1]);
  });

  it("keeps everything when nothing is selected in either direction", () => {
    // Not the same array instance: excluding programs is always active, so the
    // pass runs even with no criterion chosen.
    expect(filterLibraryGames(catalogue, "", DEFAULT_LIBRARY_FILTERS).map(g => g.id))
      .toEqual(catalogue.map(g => g.id));
  });
});

describe("negative criteria across groups, with the user's examples", () => {
  it("adventure that is not role-playing", () => {
    const result = filterLibraryGames(catalogue, "", filters({ genres: ["Adventure"], excludeGenres: ["RPG"] }));
    // Only the game confirmed as Adventure. The fourth record carries no genre
    // data, so nothing attests to it being an adventure game and it is not part
    // of the result: a filter is a promise, not a guess.
    expect(result.map(g => g.id)).toEqual([1]);
  });

  it("adventure that is not violent", () => {
    const games = [
      game({ id: 1, name: "Calm", genres: ["Adventure"], content_descriptorids: [5] }),
      game({ id: 2, name: "Bloody", genres: ["Adventure"], content_descriptorids: [2, 5] }),
    ];
    const result = filterLibraryGames(games, "", filters({ genres: ["Adventure"], hideViolenceDescriptor: true }));
    expect(result.map(g => g.id)).toEqual([1]);
  });

  it("simulators that are not racing", () => {
    const games = [
      game({ id: 1, name: "Farm", genres: ["Simulation"], tags: ["Farming Sim"] }),
      game({ id: 2, name: "Racer", genres: ["Simulation", "Racing"], tags: ["Racing"] }),
      game({ id: 3, name: "Truck", genres: ["Simulation"], tags: ["Automobile Sim"] }),
    ];
    const result = filterLibraryGames(games, "", filters({ genres: ["Simulation"], excludeGenres: ["Racing"] }));
    expect(result.map(g => g.id)).toEqual([1, 3]);
  });

  it("excludes a gameplay capability only on confirmed evidence", () => {
    const games = [
      game({ id: 1, name: "Solo", categories: ["Single-player"], single_player: true, multiplayer: false }),
      game({ id: 2, name: "Has MP", categories: ["Multi-player"], multiplayer: true }),
      // Metadata missing entirely: a negative must not hide it, or the exclusion
      // would be guessing.
      game({ id: 3, name: "Unknown" }),
    ];
    const result = filterLibraryGames(games, "", filters({ excludeFeatures: ["multiplayer" as LibraryFeatureKey] }));
    expect(result.map(g => g.id)).toEqual([1, 3]);
  });

  it("excludes by source only when the game actually has it", () => {
    const games = [
      game({ id: 1, name: "A", download_source_names: ["Feed A"] }),
      game({ id: 2, name: "B", download_source_names: ["Feed B"] }),
    ];
    const result = filterLibraryGames(games, "", filters({ excludeSources: ["Feed A"] }));
    expect(result.map(g => g.id)).toEqual([2]);
  });
});
