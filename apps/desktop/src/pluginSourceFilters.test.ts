import { describe, expect, it } from "vitest";
import { filterLibraryGames, EMPTY_LIBRARY_FILTERS } from "./librarySearch";
import type { CatalogGame } from "./types";
const base = { app_id: 1, slug: "a", credit_cost_per_hour: 0, copies_total: 0, copies_available: 0 } as const;
const games: CatalogGame[] = [
  { ...base, id: 1, name: "One", has_downloads: true, download_source_names: ["Feed A"] },
  { ...base, id: 2, name: "Two", has_downloads: false, download_source_names: [] },
  { ...base, id: 3, name: "Three", has_downloads: true, download_source_names: ["Feed B"] },
];
describe("Named source filters", () => {
  it("uses OR within sources and excludes unknown availability", () => {
    expect(filterLibraryGames(games, "", { ...EMPTY_LIBRARY_FILTERS, sources: ["Feed A"] }).map(game => game.id)).toEqual([1]);
    expect(filterLibraryGames(games, "", { ...EMPTY_LIBRARY_FILTERS, sources: ["Feed A", "Feed B"] }).map(game => game.id)).toEqual([1,3]);
    expect(filterLibraryGames(games, "", { ...EMPTY_LIBRARY_FILTERS, features: ["has_downloads"] }).map(game => game.id)).toEqual([1,3]);
  });
});
