import { describe, expect, it } from "vitest";

import { filterLibraryGames } from "./librarySearch";
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
