import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogGame } from "../types";
import { loadDiscoveryCatalog, mergeDiscoveryCatalog } from "./DiscoveryCatalog";
const mocks = vi.hoisted(() => ({ read: vi.fn(), sync: vi.fn(), api: vi.fn(), manifest: vi.fn() }));
vi.mock("../catalogCache", () => ({readCatalogCache: mocks.read, syncCatalogCache: mocks.sync}));
vi.mock("../settings", () => ({getApiBaseUrl: mocks.api, getCatalogManifestUrl: mocks.manifest}));
vi.mock("../narrationLog", () => ({narrate: vi.fn()}));
const game = (id: number, app_id: number, extra = {}): CatalogGame => ({
  id, app_id, name: "Fixture", slug: "fixture", credit_cost_per_hour: 0, copies_total: 0, copies_available: 0, ...extra,
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe("discovery catalog", () => {
  it("paints the installer snapshot without contacting an API", async () => {
    mocks.read.mockResolvedValue([game(7, 100, {tags: ["Puzzle"]})]);
    const result = await loadDiscoveryCatalog(false);
    expect(result?.[0]).toMatchObject({id: 100, catalog_cache_id: 7, tags: ["Puzzle"]});
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("detects new shared revisions even when the GameAccess server is stopped", async () => {
    mocks.read.mockResolvedValueOnce([game(7, 100)]).mockResolvedValueOnce([game(7, 100), game(8, 200)]);
    mocks.manifest.mockResolvedValue("https://raw.githubusercontent.com/example/catalog-manifest.json");
    mocks.sync.mockResolvedValue({updated: true, revision: "next", catalog_count: 2});
    expect(await loadDiscoveryCatalog(true)).toHaveLength(2);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it("a smaller API catalog keeps new games and verified third-party tags", () => {
    const result = mergeDiscoveryCatalog([game(7, 100, {tags: ["Couch co-op: 4 players"], local_players_max: 4}), game(8, 200)],
      [game(100, 100, {tags: ["Action"], local_players_max: null})]);
    expect(result).toHaveLength(2);
    expect(result[0].tags).toEqual(["Couch co-op: 4 players", "Action"]);
    expect(result[0].local_players_max).toBe(4);
  });
  it("failed synchronization does not replace the baseline with stale bundled JSON", async () => {
    mocks.read.mockResolvedValue([game(7, 100)]);
    mocks.manifest.mockResolvedValue("https://raw.githubusercontent.com/example/manifest");
    mocks.sync.mockRejectedValue(new Error("offline"));
    mocks.api.mockResolvedValue("http://catalog.test");
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:false, status:503}));
    await expect(loadDiscoveryCatalog(true)).rejects.toThrow("503");
  });
});
