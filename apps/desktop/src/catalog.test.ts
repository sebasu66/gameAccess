import { describe, expect, it } from "vitest";
import { buildLocalCatalog, mergeCatalog } from "./catalog";
import type { LocalSteamPool } from "./native";
import type { CatalogGame } from "./types";

const pool: LocalSteamPool = {
  source: "steam-console-licenses-print-cache",
  verification_complete: true,
  verified_at: "2026-08-30T00:00:00Z",
  games: [{ app_id: 10, name: "Local Game" }, { app_id: 20, name: "Family Game" }],
  accounts: [
    { label: "Owner", account_name: "owner", steam_id64: "1", app_ids: [10], accessible_app_ids: [10, 20], ownership_verified: true, ownership_source: "steam-console-licenses-print-cache", active: true },
    { label: "Second", account_name: "second", steam_id64: "2", app_ids: [], accessible_app_ids: [20], ownership_verified: true, ownership_source: "steam-console-licenses-print-cache", active: false },
  ],
};

describe("buildLocalCatalog", () => {
  it("creates catalog entries from verified pool games", () => {
    const games = buildLocalCatalog(pool);
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({ app_id: 10, name: "Local Game", copies_total: 1, copies_available: 1 });
  });

  it("keeps ownership and Family accessibility separate", () => {
    const game = buildLocalCatalog(pool).find((item) => item.app_id === 20);
    expect(game).toBeDefined();
    expect(game).toMatchObject({ copies_total: 0, copies_available: 0, availability_state: "unavailable" });
    expect(game?.local_account_labels).toEqual([]);
    expect(game?.local_access_labels).toEqual(["owner", "second"]);
    expect(game?.local_primary_account_label).toBeUndefined();
  });

  it("counts duplicate verified owners as copies but never Family access", () => {
    const duplicatePool: LocalSteamPool = {
      ...pool,
      games: [{ app_id: 10, name: "Local Game" }],
      accounts: [
        ...pool.accounts,
        { label: "Other owner", account_name: "other", steam_id64: "3", app_ids: [10], accessible_app_ids: [10], ownership_verified: true, ownership_source: "steam-console-licenses-print-cache", active: false },
      ],
    };
    const game = buildLocalCatalog(duplicatePool)[0];
    expect(game.copies_total).toBe(2);
    expect(game.copies_available).toBe(2);
    expect(game.local_account_labels).toEqual(["owner", "other"]);
    expect(game.local_primary_account_label).toBe("owner");
  });

  it("fails closed when app_ids contains a game but the account is not verified", () => {
    const cyberpunkPool: LocalSteamPool = {
      source: "steam-console-licenses-print-cache",
      verification_complete: false,
      verified_at: "2026-08-30T00:00:00Z",
      games: [{ app_id: 1091500, name: "Cyberpunk 2077" }],
      accounts: [
        {
          label: "vz3644",
          account_name: "vz3644",
          steam_id64: "4",
          app_ids: [1091500],
          accessible_app_ids: [1091500],
          ownership_verified: false,
          ownership_source: "unverified",
          active: false,
        },
      ],
    };
    const game = buildLocalCatalog(cyberpunkPool)[0];
    expect(game.copies_total).toBe(0);
    expect(game.copies_available).toBe(0);
    expect(game.availability_state).toBe("unavailable");
    expect(game.local_account_labels).toEqual([]);
    expect(game.local_primary_account_label).toBeUndefined();
  });
});

describe("mergeCatalog", () => {
  it("deduplicates by AppID and preserves the backend game id for leasing", () => {
    const remote: CatalogGame[] = [{ id: 77, slug: "remote", name: "Remote Name", app_id: 10, credit_cost_per_hour: 50, copies_total: 2, copies_available: 1 }];
    const merged = mergeCatalog(remote, buildLocalCatalog(pool));
    const game = merged.find((item) => item.app_id === 10);
    expect(game).toBeDefined();
    if (!game) throw new Error("Merged game missing");
    expect(merged.filter((item) => item.app_id === 10)).toHaveLength(1);
    expect(game.id).toBe(77);
    expect(game.local_account_labels).toEqual(["owner"]);
    expect(game.local_primary_account_label).toBe("owner");
    expect(game.local_inventory_verified).toBe(true);
  });

  it("retains local-only and remote-only games", () => {
    const remote: CatalogGame[] = [{ id: 99, slug: "remote-only", name: "Remote Only", app_id: 30, credit_cost_per_hour: 50, copies_total: 1, copies_available: 1 }];
    expect(mergeCatalog(remote, buildLocalCatalog(pool)).map((item) => item.app_id).sort()).toEqual([10, 20, 30]);
  });
});
