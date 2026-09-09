import { describe, expect, it } from "vitest";
import { buildLocalCatalog, mergeCatalog, mergeLocalWithBackendCatalog } from "./catalog";
import type { LocalSteamPool } from "./native";
import type { CatalogGame } from "./types";

const pool: LocalSteamPool = {
  source: "steam-console-licenses-print-cache",
  verification_complete: true,
  verified_at: "2026-08-30T00:00:00Z",
  games: [{ app_id: 10, name: "Local Game" }, { app_id: 20, name: "Visible Only Game" }],
  accounts: [
    { label: "Owner", account_name: "owner", steam_id64: "1", app_ids: [10], accessible_app_ids: [10, 20], ownership_verified: true, ownership_source: "steam-console-licenses-print-cache", active: true },
    { label: "Second", account_name: "second", steam_id64: "2", app_ids: [], accessible_app_ids: [20], ownership_verified: true, ownership_source: "steam-console-licenses-print-cache", active: false },
  ],
};

describe("buildLocalCatalog", () => {
  it("creates catalog entries only from verified owned/runnable pool games", () => {
    const games = buildLocalCatalog(pool);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ app_id: 10, name: "Local Game", copies_total: 1, copies_available: 1 });
  });

  it("excludes games that are only visible in Steam localconfig", () => {
    const game = buildLocalCatalog(pool).find((item) => item.app_id === 20);
    expect(game).toBeUndefined();
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
    expect(buildLocalCatalog(cyberpunkPool)).toEqual([]);
  });

  it("uses a verified Family runnable seat without requiring original ownership", () => {
    const familyPool: LocalSteamPool = {
      source: "steam-console-licenses-print",
      verification_complete: true,
      verified_at: "now",
      games: [{ app_id: 244210, name: "Assetto Corsa" }],
      accounts: [{
        label: "family",
        account_name: "family",
        app_ids: [],
        runnable_app_ids: [244210],
        runnable_verified: true,
        accessible_app_ids: [244210],
        active: false,
      }],
    };
    expect(buildLocalCatalog(familyPool)[0]).toMatchObject({
      copies_available: 1,
      availability_state: "ready",
      local_primary_account_label: "family",
    });
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
    expect(mergeCatalog(remote, buildLocalCatalog(pool)).map((item) => item.app_id).sort()).toEqual([10, 30]);
  });
});


describe("mergeLocalWithBackendCatalog", () => {
  it("never resurrects a visibility-only game from the GameAccess backend", () => {
    const remote: CatalogGame[] = [{ id: 77, slug: "remote", name: "Cyberpunk 2077", app_id: 20, credit_cost_per_hour: 1, copies_total: 2, copies_available: 1, availability_state: "ready" }];
    const merged = mergeLocalWithBackendCatalog(buildLocalCatalog(pool), remote);
    expect(merged.find((item) => item.app_id === 20)).toBeUndefined();
  });
});
