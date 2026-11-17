import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  queryCatalogCache,
  applyCatalogSources,
  removePluginCatalogSources,
  getCatalogFacets,
  readCatalogCache,
  withParentalPolicy,
} from "./catalogCache";
import { invoke } from "@tauri-apps/api/core";
import { resetParentalPolicyForTests, setParentalPolicyForTests } from "./parentalControl";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("catalogCache IPC queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = { __TAURI_INTERNALS__: {} };
    resetParentalPolicyForTests();
    setParentalPolicyForTests({ level: "off" }); // these tests check the plain forwarding
  });

  it("applies the parental policy (on by default) to every search, but not to lookups by id", async () => {
    resetParentalPolicyForTests();
    vi.mocked(invoke).mockResolvedValue({ items: [], total: 0 });
    await queryCatalogCache({ query: "x", content_descriptor_ids: [3, 5] });
    expect(invoke).toHaveBeenLastCalledWith("catalog_cache_query", {
      params: { query: "x", hide_adult: true, adult_includes_nudity: undefined, content_descriptor_ids: [5], exclude_content_descriptor_ids: undefined },
    });
    await queryCatalogCache({ app_ids: [7] });
    expect(invoke).toHaveBeenLastCalledWith("catalog_cache_query", { params: { app_ids: [7] } });
    const strict = withParentalPolicy({ exclude_content_descriptor_ids: [9] }, { enabled: true, level: "strict", hideViolence: true });
    expect(strict).toMatchObject({ hide_adult: true, adult_includes_nudity: true, exclude_content_descriptor_ids: [9, 2] });
    expect(withParentalPolicy({ query: "y" }, { enabled: false, level: "off", hideViolence: true })).toEqual({ query: "y" });
  });

  it("forwards queryCatalogCache to tauri command with params", async () => {
    const mockResult = {
      items: [{ id: 1, name: "Portal", app_id: 400, credit_cost_per_hour: 0, copies_total: 0, copies_available: 0, slug: "portal" }],
      total: 1,
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const result = await queryCatalogCache({
      query: "Portal",
      limit: 60,
      offset: 0,
    });

    expect(invoke).toHaveBeenCalledWith("catalog_cache_query", {
      params: { query: "Portal", limit: 60, offset: 0 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("forwards rating and age filter params to queryCatalogCache", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ items: [], total: 0 });

    await queryCatalogCache({
      min_rating: 70,
      max_age_days: 365,
      include_recent_unrated: true,
      limit: 100,
    });

    expect(invoke).toHaveBeenCalledWith("catalog_cache_query", {
      params: {
        min_rating: 70,
        max_age_days: 365,
        include_recent_unrated: true,
        limit: 100,
      },
    });
  });

  it("forwards app_ids filter param to queryCatalogCache", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ items: [], total: 0 });

    await queryCatalogCache({
      app_ids: [100, 200, 300],
      limit: 50,
    });

    expect(invoke).toHaveBeenCalledWith("catalog_cache_query", {
      params: {
        app_ids: [100, 200, 300],
        limit: 50,
      },
    });
  });

  it("forwards language to readCatalogCache and queryCatalogCache", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await readCatalogCache("spanish");
    expect(invoke).toHaveBeenCalledWith("catalog_cache_read", { language: "spanish" });

    vi.mocked(invoke).mockResolvedValueOnce({ items: [], total: 0 });
    await queryCatalogCache({ language: "english" });
    expect(invoke).toHaveBeenCalledWith("catalog_cache_query", { params: { language: "english" } });
  });

  it("forwards applyCatalogSources and removePluginCatalogSources to tauri commands", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      plugin_id: "ga-torrent",
      revision: "rev-1",
      sources_total: 1,
      matched_links: 1,
    });

    await applyCatalogSources({
      pluginId: "ga-torrent",
      revision: "rev-1",
      full: true,
      added: [{ key: "k1", title: "Portal 2 Repack", source: "FitGirl", multiplayer: false }],
    });

    expect(invoke).toHaveBeenCalledWith("catalog_sources_apply", {
      pluginId: "ga-torrent",
      revision: "rev-1",
      full: true,
      added: [{ key: "k1", title: "Portal 2 Repack", source: "FitGirl", multiplayer: false }],
      removed: [],
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await removePluginCatalogSources("ga-torrent");
    expect(invoke).toHaveBeenCalledWith("catalog_sources_remove_plugin", {
      pluginId: "ga-torrent",
    });
  });

  it("forwards getCatalogFacets to tauri command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ genres: ["Action", "RPG"], sources: ["FitGirl"] });

    const facets = await getCatalogFacets();
    expect(invoke).toHaveBeenCalledWith("catalog_cache_get_facets");
    expect(facets.genres).toEqual(["Action", "RPG"]);
    expect(facets.sources).toEqual(["FitGirl"]);
  });
});
