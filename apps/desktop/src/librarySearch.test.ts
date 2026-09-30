import { describe, expect, it } from "vitest";

import { filterLibraryGames, getLibrarySearchFacets } from "./librarySearch";
import type { CatalogGame } from "./types";

const game = (id: number, name: string): CatalogGame => ({
  id,
  slug: name.toLocaleLowerCase().replace(/\s+/g, "-"),
  name,
  app_id: id,
  credit_cost_per_hour: 0,
  copies_total: 1,
  copies_available: 1,
});

describe("library search", () => {
  const games = [game(1, "Cyberpunk 2077"), game(2, "Portal 2"), game(3, "The Witcher 3")];

  it("filters the existing library by game name without changing its order", () => {
    expect(filterLibraryGames(games, "cyber").map((item) => item.name)).toEqual(["Cyberpunk 2077"]);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(filterLibraryGames(games, "  PORTAL  ").map((item) => item.name)).toEqual(["Portal 2"]);
  });

  it("returns the full grid when the search is empty", () => {
    expect(filterLibraryGames(games, "   ")).toBe(games);
  });
});

describe("Steam catalog taxonomy", () => {
  const games: CatalogGame[] = [
    { ...game(10, "Adventure"), genres: ["Adventure", "Indie"], categories: ["Single-player", "Steam Achievements"] },
    { ...game(11, "Sports"), genres: ["Sports"], categories: ["Multi-player", "Online PvP", "Co-op"], coop: true },
    { ...game(12, "Local"), genres: ["Indie"], categories: ["Shared/Split Screen Co-op", "Single-player"] },
  ];
  it("keeps genres separate from every Steam feature in metadata", () => {
    const facets = getLibrarySearchFacets(games);
    expect(facets.genres).toEqual(["Adventure", "Indie", "Sports"]);
    expect(facets.categories).toContain("Single-player");
    expect(facets.categories).toContain("Online PvP");
    expect(facets.categories).toContain("Shared/Split Screen Co-op");
    expect(facets.categories).not.toContain("Sports");
  });
  it("combines a genre and a Steam feature independently of sparse boolean flags", () => {
    expect(filterLibraryGames(games, "", { genres: ["Indie"], categories: ["Single-player"], features: [] }).map(g => g.id)).toEqual([10, 12]);
    expect(filterLibraryGames(games, "", { genres: ["Sports"], categories: ["Single-player"], features: [] })).toEqual([]);
  });
});
