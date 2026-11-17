import { describe, expect, it } from "vitest";
import { freeSteamSource, steamFreeKind, unseenGiveaways, watchGiveaways } from "./freeSteamGames";
import type { CatalogGame } from "./types";

const game = (app_id: number, extra: Partial<CatalogGame> = {}) => ({ id: app_id, app_id, name: `G${app_id}`, slug: "", credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, ...extra }) as CatalogGame;
const NOW = Date.parse("2026-11-12T12:00:00Z");

describe("free Steam games", () => {
  it("knows free to play games by Steam's flag or by their genre, and free demos", () => {
    expect(steamFreeKind(game(570, { is_free: true }), NOW)).toBe("free_to_play");
    expect(steamFreeKind(game(730, { genres: ["Action", "Free To Play"] }), NOW)).toBe("free_to_play");
    expect(steamFreeKind(game(440, { tags: ["Gratis"] }), NOW)).toBe("free_to_play");
    expect(steamFreeKind(game(9, { product_type: "demo" }), NOW)).toBe("demo");
    expect(steamFreeKind(game(10, { genres: ["Action"] }), NOW)).toBeNull();
    expect(steamFreeKind(game(0, { is_free: true }), NOW)).toBeNull();
  });

  it("counts a giveaway only while it lasts, and a free weekend is played, not kept", () => {
    const keep = game(20, { steam_free_promo: { kind: "free_to_keep", starts_at: "2026-11-10T00:00:00Z", ends_at: "2026-11-14T00:00:00Z" } });
    expect(steamFreeKind(keep, NOW)).toBe("free_to_keep");
    expect(freeSteamSource(keep, NOW)).toBe("steam-depot:20");
    expect(steamFreeKind(keep, Date.parse("2026-11-15T00:00:00Z"))).toBeNull();
    expect(steamFreeKind(keep, Date.parse("2026-11-01T00:00:00Z"))).toBeNull();
    const weekend = game(21, { steam_free_promo: { kind: "free_weekend" } });
    expect(steamFreeKind(weekend, NOW)).toBe("free_weekend");
    expect(freeSteamSource(weekend, NOW)).toBeNull();
  });

  it("lists what DepotDownloader can bring, and the giveaways not told yet", () => {
    const catalog = [game(570, { is_free: true }), game(10), game(21, { steam_free_promo: { kind: "free_weekend" } }), game(20, { steam_free_promo: { kind: "free_to_keep" } })];
    expect(catalog.filter(g => freeSteamSource(g, NOW)).map(g => g.app_id)).toEqual([570, 20]);
    expect(unseenGiveaways(catalog, new Set([21]), NOW).map(g => g.app_id)).toEqual([20]);
  });

  it("tells a new giveaway once, and not the ones already free on the first look", () => {
    const saved = new Map<string, string>();
    const store = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) };
    const told: Array<Array<number | null | undefined>> = [];
    const tell = (games: CatalogGame[]) => told.push(games.map(g => g.app_id));
    const first = [game(21, { steam_free_promo: { kind: "free_weekend" } }), game(570, { is_free: true })];
    watchGiveaways(first, tell, NOW, store);
    expect(told).toEqual([]);
    const later = [...first, game(20, { steam_free_promo: { kind: "free_to_keep" } })];
    watchGiveaways(later, tell, NOW, store);
    watchGiveaways(later, tell, NOW, store);
    expect(told).toEqual([[20]]);
  });

});
