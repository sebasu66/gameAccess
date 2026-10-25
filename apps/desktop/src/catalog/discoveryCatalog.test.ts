import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { CatalogGame } from "../types";
import { catalogCheckLine, loadDiscoveryCatalog, mergeDiscoveryCatalog } from "./DiscoveryCatalog";
const mocks = vi.hoisted(() => ({ query: vi.fn(), sync: vi.fn(), api: vi.fn(), manifest: vi.fn() }));
vi.mock("../catalogCache", () => ({queryCatalogCache: mocks.query, syncCatalogCache: mocks.sync}));
vi.mock("../settings", () => ({getApiBaseUrl: mocks.api, getCatalogManifestUrl: mocks.manifest}));
vi.mock("../narrationLog", () => ({narrate: vi.fn()}));
const game = (id: number, app_id: number, extra = {}): CatalogGame => ({
  id, app_id, name: "Fixture", slug: "fixture", credit_cost_per_hour: 0, copies_total: 0, copies_available: 0, ...extra,
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe("discovery catalog", () => {
  it("paints the installer snapshot without contacting an API", async () => {
    mocks.query.mockResolvedValue({ items: [], total: 10 });
    const result = await loadDiscoveryCatalog(false);
    expect(result).toMatchObject({ updated: false, revision: "local", catalog_count: 10 });
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("a startup check asks GitHub's manifest once and never the GameAccess server, even when the server is configured", async () => {
    mocks.api.mockResolvedValue("https://gameaccess-api.example");
    mocks.manifest.mockResolvedValue("https://raw.githubusercontent.com/example/catalog-manifest.json");
    mocks.sync.mockResolvedValue({updated: true, revision: "next", catalog_count: 2});
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await loadDiscoveryCatalog(true);
    expect(result).toMatchObject({updated: true, revision: "next", catalog_count: 2});
    expect(mocks.sync.mock.calls).toEqual([["https://raw.githubusercontent.com/example/catalog-manifest.json"]]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("the shipped settings read the manifest as a plain GitHub file, not through the rate-limited GitHub API", () => {
    const settings = JSON.parse(readFileSync(new URL("../../public/gameaccess.settings.json", import.meta.url), "utf8"));
    const url = new URL(settings.catalog_manifest_url);
    expect(url.host).toBe("raw.githubusercontent.com"); // api.github.com allows 60 requests an hour per address
    expect(url.pathname.endsWith("/deploy/catalog-cache/catalog-manifest.json")).toBe(true);
  });
  it("the published manifest offers patches the app can download, all from GitHub's file host", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../../deploy/catalog-cache/catalog-manifest.json", import.meta.url), "utf8"));
    const updates = Object.entries(manifest.updates ?? {}) as Array<[string, { artifact_url: string; sha256: string }]>;
    expect(updates.length).toBeGreaterThan(0);
    for (const [base, update] of updates) {
      expect(base).not.toBe(manifest.revision);
      expect(new URL(update.artifact_url).host).toBe("raw.githubusercontent.com");
      expect(update.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new URL(manifest.artifact_url).host).toBe("raw.githubusercontent.com");
  });
  it("the log line says what the check downloaded and how long it took", () => {
    expect(catalogCheckLine({updated: false, revision: "r2", catalog_count: 44711, downloaded: "nothing", downloaded_bytes: 0, manifest_ms: 65, total_ms: 80}))
      .toBe("Discovery catalog current: revision=r2, games=44711; manifest 65 ms, downloaded nothing else, check took 80 ms.");
    expect(catalogCheckLine({updated: true, revision: "r3", catalog_count: 44800, downloaded: "patch", downloaded_bytes: 1153434, manifest_ms: 70, total_ms: 2400}))
      .toBe("Discovery catalog updated: revision=r3, games=44800; manifest 70 ms, downloaded the patch (1.10 MB), check took 2400 ms.");
  });
  it("a smaller API catalog keeps new games and verified third-party tags", () => {
    const result = mergeDiscoveryCatalog([game(7, 100, {tags: ["Couch co-op: 4 players"], local_players_max: 4}), game(8, 200)],
      [game(100, 100, {tags: ["Action"], local_players_max: null})]);
    expect(result).toHaveLength(2);
    expect(result[0].tags).toEqual(["Couch co-op: 4 players", "Action"]);
    expect(result[0].local_players_max).toBe(4);
  });
  it("failed synchronization does not replace the baseline with stale bundled JSON", async () => {
    mocks.query.mockResolvedValue({ items: [], total: 1 });
    mocks.manifest.mockResolvedValue("https://raw.githubusercontent.com/example/manifest");
    mocks.sync.mockRejectedValue(new Error("offline"));
    mocks.api.mockResolvedValue("http://catalog.test");
    vi.stubGlobal("window", {});
    const fetch = vi.fn().mockResolvedValue({ok:false, status:503});
    vi.stubGlobal("fetch", fetch);
    await expect(loadDiscoveryCatalog(true)).rejects.toThrow("El catálogo remoto no está disponible.");
    expect(fetch).not.toHaveBeenCalled(); // the whole catalog is never fetched from the server as JSON
  });
});
