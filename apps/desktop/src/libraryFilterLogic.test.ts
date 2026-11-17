import { describe, expect, it } from "vitest";
import { classifyFilterMatch, filterLibraryGames, gameMatchesLibraryFeature, type LibrarySearchFilters } from "./librarySearch";
import { buildLibraryCollection } from "./librarySections";
import { mergeLocalCatalogMetadata } from "./steamMetadata";
import type { CatalogGame } from "./types";

// Capability snapshots checked on SteamDB, 2026-10-07. These are categories,
// not community tags. Compare the same AppIDs rather than catalog-wide counts.
const base = (id: number, categories: string[], genres = ["Action"]): CatalogGame => ({ id, app_id: id, name: `Game ${id}`, slug: `game-${id}`, credit_cost_per_hour: 0, copies_total: 0, copies_available: 0, categories, genres });
const portal = base(620, ["Single-player", "Multi-player", "Co-op", "Online Co-op", "Shared/Split Screen Co-op", "Shared/Split Screen"]); // https://steamdb.info/app/620/info/
const stardew = base(413150, [...portal.categories!, "LAN Co-op"], ["RPG", "Simulation"]); // https://steamdb.info/app/413150/info/
const cs2 = { ...base(730, ["Multi-player", "Cross-Platform Multiplayer"]), tags: ["PvP", "Co-op", "Online Co-Op"] }; // https://steamdb.info/app/730/info/
const filters = (features: LibrarySearchFilters["features"], genres: string[] = [], ): LibrarySearchFilters => ({ features, genres, categories: [] });

describe("grouped Steam capability filters", () => {
  it("preserves overlapping single/multiplayer and connection capabilities", () => {
    for (const key of ["single_player", "multiplayer", "online_multiplayer", "local_multiplayer", "coop", "shared_split_screen"] as const) expect(gameMatchesLibraryFeature(stardew, key)).toBe(true);
    expect(gameMatchesLibraryFeature(stardew, "coop_lan")).toBe(true);
    // "Admite multijugador" plus its branch options: a game that offers both
    // modes satisfies the inclusive side.
    expect(classifyFilterMatch(stardew, filters(["multiplayer", "coop", "lan", "online_multiplayer"]))).toBe("confirmed");
  });
  it("uses OR for genres and connections, AND across groups", () => {
    expect(filterLibraryGames([portal, stardew, cs2], "", filters([], ["Adventure", "Action", "RPG"]))).toHaveLength(3);
    expect(classifyFilterMatch(portal, filters(["coop", "lan", "online_multiplayer"]))).toBe("confirmed");
    expect(classifyFilterMatch(portal, filters(["coop"], ["RPG"]))).toBe("excluded");
  });
  it("never confirms a capability from a community tag", () => {
    expect(classifyFilterMatch(cs2, filters(["multiplayer"]))).toBe("confirmed");
    // CS2 carries no Co-op category, only a Co-op tag. A tag is user opinion, so
    // it cannot satisfy a required criterion: the game is simply not a co-op
    // result. Tags stay searchable as text, they just do not filter.
    expect(classifyFilterMatch(cs2, filters(["coop", "online_multiplayer"]))).toBe("excluded");
  });
  it("does not invent LAN Co-op from LAN PvP plus Online Co-op", () => {
    const mixed = base(1, ["Multi-player", "Online Co-op", "LAN PvP"]);
    // Co-op over LAN needs the combined category. Having online co-op and LAN PvP
    // is not that, so the game is not a result for the pair.
    expect(gameMatchesLibraryFeature(mixed, "coop_lan")).toBe(false);
    expect(classifyFilterMatch(mixed, filters(["coop", "lan"]))).toBe("excluded");
    expect(classifyFilterMatch(mixed, filters(["pvp", "lan"]))).toBe("confirmed");
    expect(classifyFilterMatch(stardew, filters(["coop", "lan"]))).toBe("confirmed");
    expect(classifyFilterMatch(stardew, filters(["coop", "lan", "shared_split_screen"]))).toBe("confirmed");
    expect(classifyFilterMatch({ ...base(4, []), steam_category_ids: [1, 9, 48] }, filters(["coop", "lan"]))).toBe("confirmed");
  });
  it("leaves out records whose categories cannot confirm the criterion", () => {
    // No categories at all: nothing attests to multiplayer or LAN, so the game is
    // not part of those results. A gap is not a yes.
    expect(classifyFilterMatch(base(2, [], []), filters(["multiplayer", "lan"], ["RPG"]))).toBe("excluded");
    expect(classifyFilterMatch(base(3, ["Single-player"]), filters(["multiplayer"]))).toBe("excluded");
    // PvE shares the Co-op option, and a single-player-only record does not offer it.
    expect(classifyFilterMatch(base(3, ["Single-player"]), filters(["single_player", "pve"]))).toBe("excluded");
    expect(classifyFilterMatch(base(3, ["Single-player"]), filters(["pve"]))).toBe("excluded");
    // And the same record with no data is equally not a PvE result.
    expect(classifyFilterMatch(base(5, []), filters(["pve"]))).toBe("excluded");
  });
  it("reads the players branch asymmetrically, matching its labels", () => {
    // Stardew supports both modes; measured on the real catalog, 389 games do.
    // "Solo un jugador" is restrictive, so it must not list them.
    expect(classifyFilterMatch(stardew, filters(["single_player"]))).toBe("excluded");
    // "Admite multijugador" is inclusive: multiplayer-only or both.
    expect(classifyFilterMatch(stardew, filters(["multiplayer"]))).toBe("confirmed");
    // A genuinely single-player-only record satisfies the restrictive side.
    expect(classifyFilterMatch(base(3, ["Single-player"]), filters(["single_player"]))).toBe("confirmed");
    // And is rejected by the multiplayer side.
    expect(classifyFilterMatch(base(3, ["Single-player"]), filters(["multiplayer"]))).toBe("excluded");
  });
  it("applies the multiplayer branch only under its parent", () => {
    const lanBoth = base(9, ["Single-player", "Multi-player", "LAN Co-op"]);
    // Under "Admite multijugador" the branch option is a hard requirement.
    expect(classifyFilterMatch(lanBoth, filters(["multiplayer", "lan"]))).toBe("confirmed");
    expect(classifyFilterMatch(base(10, ["Single-player", "Multi-player"]), filters(["multiplayer", "lan"]))).toBe("excluded");
    // Contradicting the restrictive side yields nothing.
    expect(classifyFilterMatch(lanBoth, filters(["single_player", "lan"]))).toBe("excluded");
  });
  it("keeps both matches and does not lift favorites above the sort", () => {
    // CS2 is not a co-op result: it carries a Co-op tag but no Co-op category, and
    // a tag cannot satisfy a required criterion.
    const games = filterLibraryGames([cs2, portal, stardew], "", filters(["coop"]));
    expect([...games.map(game => game.id)].sort((a, b) => a - b)).toEqual([620, 413150]);
    // A like only feeds recommendations: the order is the same with or without it.
    const plain = buildLibraryCollection(games, {}, {}, {}, "catalog", "name").games;
    expect([...plain.map(game => game.id)].sort((a, b) => a - b)).toEqual([620, 413150]);
    const favorite = buildLibraryCollection(games, {}, { 413150: 1 }, {}, "catalog", "name").games;
    expect(favorite.map(game => game.id)).toEqual(plain.map(game => game.id));
  });
  it("worker metadata updates genres/categories and ratings without replacing install commands", () => {
    const updated = mergeLocalCatalogMetadata({ ...cs2, coop: true, playProcess: "existing-command" }, { categories: [{ description: "LAN PvP" }], genres: [{ description: "Strategy" }], gameaccess_reviews: { total_reviews: 10, total_positive: 9 } });
    expect(updated).toMatchObject({ id: 730, genres: ["Strategy"], steam_review_score: 90, playProcess: "existing-command" });
    expect(gameMatchesLibraryFeature(updated, "coop")).toBe(false);
  });
});
