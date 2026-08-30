import { describe, expect, it } from "vitest";
import { buildLocalCatalog, mergeCatalog } from "./catalog";
import type { LocalSteamPool } from "./native";
import type { CatalogGame } from "./types";

const pool: LocalSteamPool = {
  source: "steam-console-licenses-print",
  verification_complete: true,
  verified_at: "2026-08-30T00:00:00Z",
  games: [{ app_id: 10, name: "Local Game" }, { app_id: 20, name: "Family Game" }],
  accounts: [
    { label: "Owner", account_name: "owner", steam_id64: "1", app_ids: [10], accessible_app_ids: [10, 20], active: true },
    { label: "Second", account_name: "second", steam_id64: "2", app_ids: [], accessible_app_ids: [20], active: false },
  ],
};

describe("buildLocalCatalog", () => {
  it("creates catalog entries from real pool games", () => {
    const games = buildLocalCatalog(pool);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ app_id: 10, name: "Local Game", copies_total: 1, copies_available: 1 });
  });

  it("keeps ownership and Family accessibility separate", () => {
    const game = buildLocalCatalog(pool).find((item) => item.app_id === 20);
    expect(game).toBeUndefined();
  });

  it("counts duplicate owners as copies but never Family access", () => {
    const duplicatePool: LocalSteamPool = {
      ...pool,
      games: [{ app_id: 10, name: "Local Game" }],
      accounts: [
        ...pool.accounts,
        { label: "Other owner", account_name: "other", steam_id64: "3", app_ids: [10], accessible_app_ids: [10], active: false },
      ],
    };
    const game = buildLocalCatalog(duplicatePool)[0];
    expect(game.copies_total).toBe(2);
    expect(game.copies_available).toBe(2);
    expect(game.local_account_labels).toEqual(["owner", "other"]);
    expect(game.local_primary_account_label).toBe("owner");
  });
});

describe("mergeCatalog", () => {
  it("deduplicates by AppID and preserves the backend game id for leasing", () => {
    const remote: CatalogGame[] = [{ id: 77, slug: "remote", name: "Remote Name", app_id: 10, credit_cost_per_hour: 50, copies_total: 2, copies_available: 1 }];
    const merged = mergeCatalog(remote, buildLocalCatalog(pool));
    const game = merged.find((item) => item.app_id === 10)!;
    expect(merged.filter((item) => item.app_id === 10)).toHaveLength(1);
    expect(game.id).toBe(77);
    expect(game.local_account_labels).toEqual(["owner"]);
    expect(game.local_primary_account_label).toBe("owner");
    expect(game.local_inventory_verified).toBe(true);
  });

  it("retains local-only and remote-only games", () => {
    const remote: CatalogGame[] = [{ id: 99, slug: "remote-only", name: "Remote Only", app_id: 30, credit_cost_per_hour: 50, copies_total: 1, copies_available: 1 }];
    expect(mergeCatalog(remote, buildLocalCatalog(pool)).map((item) => item.app_id).sort()).toEqual([10, 30]);
  });
});
