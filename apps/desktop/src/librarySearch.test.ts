import { describe, expect, it } from "vitest";

import {
  filterLibraryGames,
  gameMatchesLibraryFeature,
  getLibrarySearchFacets,
} from "./librarySearch";
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

describe("library text search", () => {
  const games: CatalogGame[] = [
    {
      ...game(1, "Cyberpunk 2077"),
      genres: ["RPG"],
      tags: ["Open World", "Story Rich"],
      developers: ["CD PROJEKT RED"],
      short_description: "A futuristic role-playing game.",
    },
    {
      ...game(2, "Portal 2"),
      genres: ["Puzzle"],
      tags: ["Co-op", "Funny"],
      developers: ["Valve"],
      short_description: "Physics puzzles.",
    },
    {
      ...game(3, "Tiny Cabin"),
      genres: ["Simulation"],
      tags: ["Cozy", "Indie", "Relaxing"],
      developers: ["Small Studio"],
    },
  ];

  it("matches titles without changing library order", () => {
    expect(filterLibraryGames(games, "cyber").map((item) => item.name)).toEqual(["Cyberpunk 2077"]);
  });

  it("matches community tags", () => {
    expect(filterLibraryGames(games, "cozy").map((item) => item.name)).toEqual(["Tiny Cabin"]);
    expect(filterLibraryGames(games, "story rich").map((item) => item.name)).toEqual(["Cyberpunk 2077"]);
  });

  it("does not search developers, descriptions, or genres as free text", () => {
    expect(filterLibraryGames(games, "Valve")).toEqual([]);
    expect(filterLibraryGames(games, "futuristic")).toEqual([]);
    expect(filterLibraryGames(games, "Puzzle")).toEqual([]);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(filterLibraryGames(games, "  PORTAL  ").map((item) => item.name)).toEqual(["Portal 2"]);
  });

  it("returns the whole grid when search is empty, with no criterion applied", () => {
    const result = filterLibraryGames(games, "   ");
    // Every fixture is a game, so the default games-only search keeps them all.
    // It is no longer the same array instance: "not a program" is a real filter.
    expect(result.map((item) => item.id)).toEqual(games.map((item) => item.id));
  });
});

describe("useful catalog facets", () => {
  it("filters category-only Digital records in English and Spanish", () => {
    const records = [
      { ...game(21, "Online English"), categories: ["Online Co-op", "Online PvP"] },
      { ...game(22, "Local Spanish"), categories: ["Coop. a pantalla (com)partida"] },
      { ...game(23, "LAN Spanish"), categories: ["Cooperativo en LAN"] },
      { ...game(24, "Solo"), categories: ["Single-player", "Steam Cloud"] },
      { ...game(25, "MMO"), categories: ["Massively Multiplayer"] },
    ];
    const matching = (features: NonNullable<Parameters<typeof filterLibraryGames>[2]>["features"]) => filterLibraryGames(records, "", { genres: [], categories: [], features }).map(item => item.id);
    expect(matching(["online_coop"])).toEqual([21]);
    expect(matching(["local_coop"])).toEqual([22]);
    expect(matching(["coop_lan"])).toEqual([23]);
    expect(matching(["single_player"])).toEqual([24]);
    expect(matching(["mmo"])).toEqual([25]);
    expect(matching(["multiplayer"])).toEqual([21, 22, 23, 25]);
    expect(matching(["online_coop", "local_coop"])).toEqual([21, 22]);
    expect(gameMatchesLibraryFeature({ ...game(26, "Unknown"), tags: ["Co-op"], categories: ["Steam Cloud", "Remote Play Together"] }, "coop")).toBe(false);
  });
  const games: CatalogGame[] = [
    {
      ...game(10, "Adventure"),
      genres: ["Adventure", "Indie"],
      categories: ["Un jugador", "Steam Cloud", "Remote Play Together"],
      single_player: true,
    },
    {
      ...game(11, "Online Sports"),
      genres: ["Sports"],
      categories: ["Multijugador", "JcJ en línea", "Steam Achievements"],
      multiplayer: true,
      pvp: true,
    },
    {
      ...game(12, "Local Party"),
      genres: ["Indie"],
      categories: ["Coop. a pantalla (com)partida", "Cooperativo en LAN"],
      multiplayer: true,
      coop: true,
      local_coop: true,
      shared_split_screen: true,
    },
  ];

  it("shows genres and gameplay modes, not noisy Steam capability categories", () => {
    const facets = getLibrarySearchFacets(games);
    expect(facets.genres).toEqual(["adventure", "sports", "indie"]);
    expect(facets.categories).toEqual([]);
    expect(facets.features).toContain("single_player");
    expect(facets.features).toContain("online_multiplayer");
    expect(facets.features).toContain("local_multiplayer");
    expect(facets.features).toContain("lan");
    expect(facets.features).toContain("coop_lan");
    expect(facets.features).toContain("multiplayer_lan");
  });

  it("combines genre groups with gameplay groups instead of accepting unrelated genres", () => {
    const result = filterLibraryGames(games, "", {
      genres: ["Adventure"],
      categories: [],
      features: ["pvp", "local_coop"],
    });
    expect(result.map((item) => item.id)).toEqual([]);
  });

  it("derives online/local/LAN modes from useful Steam categories", () => {
    expect(gameMatchesLibraryFeature(games[1], "online_multiplayer")).toBe(true);
    expect(gameMatchesLibraryFeature(games[2], "local_multiplayer")).toBe(true);
    expect(gameMatchesLibraryFeature(games[2], "lan")).toBe(true);
    expect(gameMatchesLibraryFeature(games[2], "coop_lan")).toBe(true);
    expect(gameMatchesLibraryFeature(games[2], "multiplayer_lan")).toBe(true);
  });

  it("keeps text search restrictive with grouped filters", () => {
    const result = filterLibraryGames(games, "Local", {
      genres: ["Indie"],
      categories: [],
      features: ["coop"],
    });
    expect(result.map((item) => item.id)).toEqual([12]);
  });
});
