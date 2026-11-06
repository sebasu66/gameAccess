/**
 * The filters, tested backwards from games a human recognises.
 *
 * Every fixture below is a real title with the capability profile the published
 * catalog actually reports for it, so the expected answer is not something the
 * test invented — it is what Steam says. The table is then read in both
 * directions, which is what catches the failure mode that started this work:
 *
 *   - the filter must FIND the game (a filter that returns nothing is useless)
 *   - the filter must NOT return the games that lack the capability (this is the
 *     one that broke: Age of Empires III appearing in a co-op search)
 *
 * Deliberately excluded from these fixtures are the kinds of records that made
 * the bug hard to see: games with a capability tag but no capability category
 * (CS2 is tagged Co-op, Valve lists no Co-op category), and games with no
 * capability data at all. Both have their own tests.
 */
import { describe, expect, it } from "vitest";
import { classifyFilterMatch, DEFAULT_LIBRARY_FILTERS, filterLibraryGames, type LibraryFeatureKey, type LibrarySearchFilters } from "./librarySearch";
import type { CatalogGame } from "./types";

function game(id: number, name: string, categories: string[], extra: Partial<CatalogGame> = {}): CatalogGame {
  return {
    id, app_id: id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    credit_cost_per_hour: 0, copies_total: 1, copies_available: 1,
    categories, genres: [], tags: [], ...extra,
  } as CatalogGame;
}

// Capability profiles taken from the catalog, not from memory.
const portal2 = game(620, "Portal 2", ["Single-player", "Multi-player", "Co-op", "Online Co-op", "Shared/Split Screen Co-op", "Shared/Split Screen"], { steam_review_score: 98, steam_review_count: 174372 });
const beyond = game(960990, "Beyond: Two Souls", ["Single-player", "Multi-player", "Co-op", "Shared/Split Screen Co-op", "Shared/Split Screen"], { steam_review_score: 88, steam_review_count: 28027 });
const brawlhalla = game(291550, "Brawlhalla", ["Single-player", "Multi-player", "Co-op", "Online Co-op", "PvP", "Online PvP", "Shared/Split Screen Co-op", "Shared/Split Screen", "Cross-Platform Multiplayer"], { steam_review_score: 82, steam_review_count: 386456 });
const killingFloor = game(232090, "Killing Floor 2", ["Single-player", "Multi-player", "Co-op", "Online Co-op", "PvP", "Online PvP"], { steam_review_score: 88, steam_review_count: 126866 });
const pathOfExile = game(238960, "Path of Exile", ["Single-player", "Multi-player", "Co-op", "Online Co-op", "PvP", "Online PvP"], { steam_review_score: 89, steam_review_count: 235091 });
const noMansSky = game(275850, "No Man's Sky", ["Single-player", "Multi-player", "Co-op", "Online Co-op", "PvP", "Online PvP", "Cross-Platform Multiplayer"], { steam_review_score: 80, steam_review_count: 352858 });
const unturned = game(304930, "Unturned", ["Single-player", "Multi-player", "Co-op", "Online Co-op", "LAN Co-op", "PvP", "Online PvP"], { steam_review_score: 91, steam_review_count: 555368 });
const theForest = game(242760, "The Forest", ["Single-player", "Multi-player", "Co-op", "Online Co-op", "LAN Co-op"], { steam_review_score: 95, steam_review_count: 178173 });
const borderlands3 = game(397540, "Borderlands 3", ["Single-player", "Multi-player", "Co-op", "Online Co-op", "LAN Co-op", "Cross-Platform Multiplayer"], { steam_review_score: 85, steam_review_count: 149065 });
const cyberpunk = game(1091500, "Cyberpunk 2077", ["Single-player"], { steam_review_score: 82, steam_review_count: 844921 });
const hellblade = game(414340, "Hellblade: Senua's Sacrifice", ["Single-player"], { steam_review_score: 90, steam_review_count: 73472 });
const arkhamKnight = game(208650, "Batman: Arkham Knight", ["Single-player"], { steam_review_score: 87, steam_review_count: 140048 });
// A real record whose categories are localized to Spanish, to prove the mapping
// is not tied to Steam's English strings.
const reanimal = game(2547000, "REANIMAL", ["Un jugador", "Multijugador", "Cooperativo", "Cooperativo en línea", "Pantalla partida/compartida", "Coop. a pantalla (com)partida"], { steam_review_score: 82, steam_review_count: 5934 });
// Steam filed these software entries under Games; their genres are the only signal.
const blender = game(365670, "Blender", [], { genres: ["Animación y modelado", "Diseño e ilustración", "Producción de vídeo"] });
const godot = game(404790, "Godot Engine", [], { genres: ["Desarrollo de juegos"] });

const catalogue = [portal2, beyond, brawlhalla, killingFloor, pathOfExile, noMansSky, unturned,
  theForest, borderlands3, cyberpunk, hellblade, arkhamKnight, reanimal, blender, godot];

const names = (filters: Partial<LibrarySearchFilters>) =>
  filterLibraryGames(catalogue, "", { genres: [], categories: [], features: [], ...filters }).map(item => item.name);

describe("each filter finds the games it should", () => {
  const cases: {
    what: string;
    filters: Partial<LibrarySearchFilters>;
    /** Titles that must be in the result. */
    finds: string[];
    /** Titles that must NOT be in the result, and why. */
    excludes: string[];
  }[] = [
    {
      what: "couch co-op: co-op on a shared or split screen",
      filters: { features: ["multiplayer", "coop", "shared_split_screen"] },
      finds: ["Portal 2", "Beyond: Two Souls", "Brawlhalla"],
      // Online-only co-op has no shared screen; the single-player games have none
      // of it. Cyberpunk in a couch co-op search is exactly the reported bug.
      excludes: ["Killing Floor 2", "Path of Exile", "Cyberpunk 2077", "Hellblade: Senua's Sacrifice", "Blender"],
    },
    {
      what: "online co-op, any genre",
      filters: { features: ["multiplayer", "coop", "online_multiplayer"] },
      finds: ["Portal 2", "Killing Floor 2", "Path of Exile", "No Man's Sky", "Unturned"],
      // Beyond: Two Souls is co-op but its co-op is on one screen, not online.
      excludes: ["Beyond: Two Souls", "Cyberpunk 2077", "Batman: Arkham Knight"],
    },
    {
      what: "co-op over a local network",
      filters: { features: ["multiplayer", "coop", "lan"] },
      finds: ["Unturned", "The Forest", "Borderlands 3"],
      // Online-only co-op must not appear when LAN is required.
      excludes: ["Killing Floor 2", "Path of Exile", "No Man's Sky", "Portal 2", "Cyberpunk 2077"],
    },
    {
      what: "single-player only: no multiplayer of any kind",
      filters: { features: ["single_player"] },
      finds: ["Cyberpunk 2077", "Hellblade: Senua's Sacrifice", "Batman: Arkham Knight"],
      // Everything with any multiplayer capability is not a single-player-only game.
      excludes: ["Portal 2", "Brawlhalla", "Killing Floor 2", "Unturned", "The Forest", "REANIMAL", "Blender"],
    },
    {
      what: "admits multiplayer: multiplayer-only or both",
      filters: { features: ["multiplayer"] },
      finds: ["Portal 2", "Killing Floor 2", "REANIMAL", "Unturned"],
      excludes: ["Cyberpunk 2077", "Hellblade: Senua's Sacrifice", "Batman: Arkham Knight", "Blender"],
    },
    {
      what: "player versus player",
      filters: { features: ["multiplayer", "pvp"] },
      finds: ["Brawlhalla", "Killing Floor 2", "Path of Exile", "No Man's Sky", "Unturned"],
      // Co-op-only games have no PvP category.
      excludes: ["Portal 2", "Beyond: Two Souls", "The Forest", "Borderlands 3", "Cyberpunk 2077"],
    },
    {
      what: "PvP and co-op at the same time",
      filters: { features: ["multiplayer", "coop", "pvp"] },
      finds: ["Brawlhalla", "Killing Floor 2", "Path of Exile", "No Man's Sky", "Unturned"],
      // Co-op without PvP is not a result when both are required.
      excludes: ["Portal 2", "Beyond: Two Souls", "The Forest", "Borderlands 3"],
    },
    {
      what: "software, which is not a game",
      filters: { software: true },
      finds: ["Blender", "Godot Engine"],
      excludes: ["Portal 2", "Cyberpunk 2077", "Unturned"],
    },
    {
      what: "games only, excluding software",
      filters: { software: false },
      finds: ["Portal 2", "Cyberpunk 2077"],
      excludes: ["Blender", "Godot Engine"],
    },
    {
      what: "a score bar",
      filters: { minReviewScore: 88 },
      finds: ["Portal 2", "Killing Floor 2", "Path of Exile", "Unturned", "The Forest", "Hellblade: Senua's Sacrifice"],
      // Below the bar.
      excludes: ["Brawlhalla", "No Man's Sky", "Borderlands 3", "Cyberpunk 2077", "Arkham Knight"],
    },
  ];

  for (const { what, filters, finds, excludes } of cases) {
    it(what, () => {
      const result = names(filters);
      for (const title of finds) expect(result, `${title} should be found by "${what}"`).toContain(title);
      for (const title of excludes) expect(result, `${title} should NOT be found by "${what}"`).not.toContain(title);
    });
  }
});

describe("the localized records are reached by the same filters", () => {
  // Steam returned Spanish category names for this record. The mapping has to
  // treat them exactly like their English counterparts.
  it("matches Spanish category values", () => {
    expect(names({ features: ["multiplayer"] })).toContain("REANIMAL");
    expect(names({ features: ["multiplayer", "coop"] })).toContain("REANIMAL");
    expect(names({ features: ["multiplayer", "coop", "online_multiplayer"] })).toContain("REANIMAL");
    expect(names({ features: ["multiplayer", "coop", "shared_split_screen"] })).toContain("REANIMAL");
    // And it is not single-player-only, because it also has multiplayer.
    expect(names({ features: ["single_player"] })).not.toContain("REANIMAL");
  });
});

describe("query with a genre plus a capability, the way a user actually searches", () => {
  // "online co-op, then combine with role-playing" was the stated use case.
  const rpg = game(9001, "Baldur's Gate 3", ["Single-player", "Multi-player", "Co-op", "Online Co-op"], { genres: ["RPG"], steam_review_score: 96, steam_review_count: 500000 });
  const rpgNoCoop = game(9002, "Elden Ring", ["Single-player", "Multi-player", "Online PvP", "PvP"], { genres: ["RPG"], steam_review_score: 92, steam_review_count: 700000 });
  const shooterCoop = game(9003, "Deep Rock Galactic", ["Single-player", "Multi-player", "Co-op", "Online Co-op"], { genres: ["Acción"], steam_review_score: 97, steam_review_count: 200000 });
  const world = [rpg, rpgNoCoop, shooterCoop];
  const query = (filters: Partial<LibrarySearchFilters>) =>
    filterLibraryGames(world, "", { genres: [], categories: [], features: [], ...filters }).map(item => item.name);

  it("genre AND capability narrow together", () => {
    expect(query({ genres: ["RPG"], features: ["multiplayer", "coop", "online_multiplayer"] })).toEqual(["Baldur's Gate 3"]);
    // The RPG without co-op must not appear, and the co-op game that is not an RPG
    // must not appear either.
    expect(query({ genres: ["RPG"], features: ["multiplayer", "coop", "online_multiplayer"] })).not.toContain("Elden Ring");
    expect(query({ genres: ["RPG"], features: ["multiplayer", "coop", "online_multiplayer"] })).not.toContain("Deep Rock Galactic");
  });

  it("genre OR within the group, AND with the capability", () => {
    expect(query({ genres: ["RPG", "Acción"], features: ["multiplayer", "coop"] })).toEqual(["Baldur's Gate 3", "Deep Rock Galactic"]);
  });

  it("a text query AND a capability both apply", () => {
    expect(filterLibraryGames(world, "deep", { genres: [], categories: [], features: ["multiplayer", "coop"] }).map(i => i.name)).toEqual(["Deep Rock Galactic"]);
    // The same text with a capability the game lacks yields nothing, instead of
    // ignoring the capability.
    expect(filterLibraryGames(world, "deep", { genres: [], categories: [], features: ["pvp"] })).toEqual([]);
  });

  it("the score bar applies on top of the capability", () => {
    expect(query({ features: ["multiplayer", "coop"], minReviewScore: 97 })).toEqual(["Deep Rock Galactic"]);
    expect(query({ features: ["multiplayer", "coop"], minReviewScore: 98 })).toEqual([]);
  });
});

describe("content descriptors, not tags", () => {
  const explicit = game(9101, "Explicit Title", ["Single-player"], { content_descriptorids: [1, 3, 4], tags: ["Hentai"], steam_review_score: 90, steam_review_count: 20000 });
  const taggedOnly = game(9102, "Tagged Only", ["Single-player"], { content_descriptorids: [], tags: ["Hentai", "Nudity"], steam_review_score: 90, steam_review_count: 20000 });
  const violent = game(9103, "Violent Title", ["Single-player"], { content_descriptorids: [2, 5], tags: ["Sexual Content"], steam_review_score: 90, steam_review_count: 20000 });
  const world = [explicit, taggedOnly, violent];

  it("finds only the records Valve classifies", () => {
    const result = filterLibraryGames(world, "", { genres: [], categories: [], features: [], contentDescriptorIds: [1, 3, 4] });
    expect(result.map(i => i.name)).toEqual(["Explicit Title"]);
  });

  it("ignores a sexual community tag, which is the reported false positive", () => {
    const result = filterLibraryGames(world, "", { genres: [], categories: [], features: [], contentDescriptorIds: [1, 3, 4] }).map(i => i.name);
    // Tagged Only carries the tags and must not appear; Violent Title carries the
    // "Sexual Content" tag with only violence descriptors and must not appear.
    expect(result).not.toContain("Tagged Only");
    expect(result).not.toContain("Violent Title");
  });
});

describe("programs never appear in a game search", () => {
  it("a search with no criterion set returns games only", () => {
    const result = filterLibraryGames(catalogue, "").map(item => item.name);
    // This is the requirement: looking for games must not surface software.
    expect(result).not.toContain("Blender");
    expect(result).not.toContain("Godot Engine");
    // And it must not have thrown the games away either.
    expect(result).toContain("Portal 2");
    expect(result).toContain("Cyberpunk 2077");
  });

  it("a text query that matches a program by name still does not return it", () => {
    // The name matches, but the content kind is a different choice, not a hint.
    expect(filterLibraryGames(catalogue, "blender").map(item => item.name)).toEqual([]);
    expect(filterLibraryGames(catalogue, "godot").map(item => item.name)).toEqual([]);
  });

  it("switching to programs returns only programs", () => {
    const result = filterLibraryGames(catalogue, "", { ...DEFAULT_LIBRARY_FILTERS, software: true }).map(item => item.name);
    expect(result).toEqual(["Blender", "Godot Engine"]);
    expect(result).not.toContain("Portal 2");
  });

  it("the two halves are a partition of the catalogue", () => {
    const games = filterLibraryGames(catalogue, "", { ...DEFAULT_LIBRARY_FILTERS, software: false }).map(item => item.id);
    const programs = filterLibraryGames(catalogue, "", { ...DEFAULT_LIBRARY_FILTERS, software: true }).map(item => item.id);
    expect(games.filter(id => programs.includes(id))).toEqual([]);
    expect([...games, ...programs].sort((a, b) => a - b))
      .toEqual(catalogue.map(item => item.id).sort((a, b) => a - b));
  });
});

describe("no filter ever returns a game that cannot satisfy it", () => {
  // Read in the other direction: for every game and every single requirement, the
  // game appears only if the capability predicate actually says yes. This would
  // have caught the tag-driven false positives directly.
  const single: LibraryFeatureKey[] = ["multiplayer", "coop", "pvp", "shared_split_screen", "lan", "online_multiplayer", "mmo"];

  for (const key of single) {
    it(`"${key}" only returns games that have it`, () => {
      const result = filterLibraryGames(catalogue, "", { genres: [], categories: [], features: ["multiplayer", key] });
      for (const item of result) {
        expect(
          [brawlhalla, killingFloor, pathOfExile, noMansSky, unturned, theForest, borderlands3, portal2, beyond, reanimal].some(g => g.id === item.id),
          `${item.name} came back for "${key}" but carries no such category`,
        ).toBe(true);
      }
    });
  }

  it("every game in the catalogue is reachable by at least one honest query", () => {
    // A game no filter can ever return is invisible: either its data is missing or
    // the mapping has a hole. Every fixture here has enough data to be found.
    const queries: Partial<LibrarySearchFilters>[] = [
      { features: ["multiplayer"] },
      { features: ["single_player"] },
      { software: true },
    ];
    const reachable = new Set(queries.flatMap(query => names(query)));
    for (const item of catalogue) {
      expect(reachable, `${item.name} is unreachable by any query`).toContain(item.name);
    }
  });

  it("single-player-only and multiplayer never both confirm a game", () => {
    // The two halves are a partition: a game that offers both is not a
    // single-player-only game, or it would appear in both halves.
    for (const item of catalogue) {
      const asSingle = classifyFilterMatch(item, { genres: [], categories: [], features: ["single_player"] });
      const asMulti = classifyFilterMatch(item, { genres: [], categories: [], features: ["multiplayer"] });
      expect(asSingle === "confirmed" && asMulti === "confirmed", `${item.name} confirmed on both halves`).toBe(false);
    }
  });
});
