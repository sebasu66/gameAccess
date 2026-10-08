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
const filters = (features: LibrarySearchFilters["features"], genres: string[] = [], includeUncertain = true): LibrarySearchFilters => ({ features, genres, categories: [], includeUncertain });

describe("grouped Steam capability filters", () => {
  it("preserves overlapping single/multiplayer and connection capabilities", () => {
    for (const key of ["single_player", "multiplayer", "online_multiplayer", "local_multiplayer", "coop", "shared_split_screen"] as const) expect(gameMatchesLibraryFeature(stardew, key)).toBe(true);
    expect(gameMatchesLibraryFeature(stardew, "coop_lan")).toBe(true);
    expect(classifyFilterMatch(stardew, filters(["single_player", "multiplayer", "coop", "lan", "online_multiplayer"]))).toBe("confirmed");
  });
  it("uses OR for genres and connections, AND across groups", () => {
    expect(filterLibraryGames([portal, stardew, cs2], "", filters([], ["Adventure", "Action", "RPG"], false))).toHaveLength(3);
    expect(classifyFilterMatch(portal, filters(["coop", "lan", "online_multiplayer"], [], false))).toBe("confirmed");
    expect(classifyFilterMatch(portal, filters(["coop"], ["RPG"]))).toBe("excluded");
  });
  it("keeps generic Multiplayer as possible, never confirms capabilities from tags", () => {
    expect(classifyFilterMatch(cs2, filters(["multiplayer"]))).toBe("confirmed");
    expect(classifyFilterMatch(cs2, filters(["coop", "online_multiplayer"]))).toBe("possible");
    expect(classifyFilterMatch(cs2, filters(["coop", "online_multiplayer"], [], false))).toBe("excluded");
  });
  it("does not invent LAN Co-op from LAN PvP plus Online Co-op", () => {
    const mixed = base(1, ["Multi-player", "Online Co-op", "LAN PvP"]);
    expect(gameMatchesLibraryFeature(mixed, "coop_lan")).toBe(false);
    expect(classifyFilterMatch(mixed, filters(["coop", "lan"]))).toBe("possible");
    expect(classifyFilterMatch(mixed, filters(["pvp", "lan"]))).toBe("confirmed");
    expect(classifyFilterMatch(stardew, filters(["coop", "lan"]))).toBe("confirmed");
    expect(classifyFilterMatch(stardew, filters(["coop", "lan", "shared_split_screen"]))).toBe("confirmed");
    expect(classifyFilterMatch({ ...base(4, []), steam_category_ids: [1, 9, 48] }, filters(["coop", "lan"]))).toBe("confirmed");
  });
  it("separates missing metadata from positively identified solo-only records", () => {
    expect(classifyFilterMatch(base(2, [], []), filters(["multiplayer", "lan"], ["RPG"]))).toBe("possible");
    expect(classifyFilterMatch(base(3, ["Single-player"]), filters(["multiplayer"]))).toBe("excluded");
    expect(classifyFilterMatch(base(3, ["Single-player"]), filters(["single_player", "pve"]))).toBe("possible");
  });
  it("sorts confirmed matches first while preserving global favorite priority", () => {
    const games = filterLibraryGames([cs2, portal, stardew], "", filters(["coop"]));
    expect(buildLibraryCollection(games, {}, {}, {}, "catalog", "name").games.map(game => game.id)).toEqual([620, 413150, 730]);
    expect(buildLibraryCollection(games, {}, { 730: 1 }, {}, "catalog", "name").games.map(game => game.id)).toEqual([730, 620, 413150]);
  });
  it("worker metadata updates genres/categories and ratings without replacing install commands", () => {
    const updated = mergeLocalCatalogMetadata({ ...cs2, coop: true, playProcess: "existing-command" }, { categories: [{ description: "LAN PvP" }], genres: [{ description: "Strategy" }], gameaccess_reviews: { total_reviews: 10, total_positive: 9 } });
    expect(updated).toMatchObject({ id: 730, genres: ["Strategy"], steam_review_score: 90, playProcess: "existing-command" });
    expect(gameMatchesLibraryFeature(updated, "coop")).toBe(false);
  });
});
