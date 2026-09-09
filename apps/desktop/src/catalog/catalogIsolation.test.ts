import { describe, expect, it } from "vitest";
import type { LocalSteamPool } from "../native";
import type { CatalogGame } from "../types";
import { GameAccessCatalog } from "./GameAccessCatalog";
import { InstalledGameStatus } from "./InstalledGameStatus";
import { PersonalCatalog } from "./PersonalCatalog";

const personal = new PersonalCatalog();

function poolFor(accounts: LocalSteamPool["accounts"]): LocalSteamPool {
  return {
    source: "verified-test",
    verification_complete: true,
    verified_at: "2026-09-08T00:00:00Z",
    accounts,
    games: [
      { app_id: 10, name: "Owned Game" },
      { app_id: 20, name: "Family Game" },
      { app_id: 1091500, name: "Cyberpunk 2077" },
    ],
  };
}

describe("PersonalCatalog", () => {
  it("includes direct ownership and verified Family runnable access", () => {
    const games = personal.build(poolFor([
      {
        label: "owner",
        account_name: "owner",
        app_ids: [10],
        accessible_app_ids: [10, 20],
        ownership_verified: true,
        active: true,
      },
      {
        label: "family",
        account_name: "family",
        app_ids: [],
        runnable_app_ids: [20],
        runnable_verified: true,
        accessible_app_ids: [20],
        ownership_verified: true,
        active: false,
      },
    ]));

    expect(games.map((game) => game.app_id)).toEqual([10, 20]);
    expect(games.find((game) => game.app_id === 10)?.local_primary_account_label).toBe("owner");
    expect(games.find((game) => game.app_id === 20)?.local_primary_account_label).toBe("family");
  });

  it("never creates a Propios game from visibility/cache alone", () => {
    const games = personal.build(poolFor([
      {
        label: "remembered",
        account_name: "remembered",
        app_ids: [],
        runnable_app_ids: [],
        runnable_verified: true,
        accessible_app_ids: [1091500],
        ownership_verified: true,
        active: true,
      },
    ]));

    expect(games.some((game) => game.app_id === 1091500)).toBe(false);
  });
});

describe("GameAccessCatalog", () => {
  it("uses backend licenses only and strips personal-license fields", async () => {
    const remote: CatalogGame = {
      id: 77,
      slug: "cyberpunk",
      name: "Cyberpunk 2077",
      app_id: 1091500,
      credit_cost_per_hour: 10,
      copies_total: 3,
      copies_available: 2,
      availability_state: "ready",
      local_account_labels: ["must-not-leak"],
      local_primary_account_label: "must-not-leak",
    };
    const catalog = new GameAccessCatalog(async () => [remote]);

    const [game] = await catalog.load();
    expect(game.app_id).toBe(1091500);
    expect(game.copies_available).toBe(2);
    expect(game.local_account_labels).toBeUndefined();
    expect(game.local_primary_account_label).toBeUndefined();
  });

  it("keeps the same AppID in Propios and GameAccess as independent rows/routes", async () => {
    const localGames = personal.build({
      source: "verified-test",
      verification_complete: true,
      verified_at: "now",
      games: [{ app_id: 10, name: "Same Game" }],
      accounts: [{
        label: "mine",
        account_name: "mine",
        app_ids: [10],
        accessible_app_ids: [10],
        ownership_verified: true,
        active: true,
      }],
    });
    const remoteGames = await new GameAccessCatalog(async () => [{
      id: 500,
      slug: "same-game",
      name: "Same Game",
      app_id: 10,
      credit_cost_per_hour: 9,
      copies_total: 4,
      copies_available: 3,
      availability_state: "ready",
    }]).load();

    expect(localGames).toHaveLength(1);
    expect(remoteGames).toHaveLength(1);
    expect(localGames[0].id).toBe(10);
    expect(remoteGames[0].id).toBe(500);
    expect(localGames[0].credit_cost_per_hour).toBe(0);
    expect(remoteGames[0].credit_cost_per_hour).toBe(9);
  });
});

describe("InstalledGameStatus", () => {
  it("normalizes installed AppIDs without changing either catalog's licenses", async () => {
    const installed = new InstalledGameStatus(async () => [1091500, 10, 1091500, 0, -1]);
    const ids = await installed.load();
    expect(ids).toEqual([10, 1091500]);
    expect(InstalledGameStatus.has(1091500, new Set(ids))).toBe(true);
    expect(InstalledGameStatus.has(20, new Set(ids))).toBe(false);
  });
});
