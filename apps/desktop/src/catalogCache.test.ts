import { describe, it, expect, vi, beforeEach } from "vitest";
import { queryCatalogCache, setCatalogTempSources, getCatalogFacets, readCatalogCache } from "./catalogCache";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("catalogCache IPC queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = { __TAURI_INTERNALS__: {} };
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

  it("forwards language to readCatalogCache and queryCatalogCache", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await readCatalogCache("spanish");
    expect(invoke).toHaveBeenCalledWith("catalog_cache_read", { language: "spanish" });

    vi.mocked(invoke).mockResolvedValueOnce({ items: [], total: 0 });
    await queryCatalogCache({ language: "english" });
    expect(invoke).toHaveBeenCalledWith("catalog_cache_query", { params: { language: "english" } });
  });

  it("forwards setCatalogTempSources to tauri command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await setCatalogTempSources([{ app_id: 400, source_names: ["FitGirl"] }]);

    expect(invoke).toHaveBeenCalledWith("catalog_cache_set_temp_sources", {
      sources: [{ app_id: 400, source_names: ["FitGirl"] }],
    });
  });

  it("forwards getCatalogFacets to tauri command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ genres: ["Action", "RPG"] });

    const facets = await getCatalogFacets();
    expect(invoke).toHaveBeenCalledWith("catalog_cache_get_facets");
    expect(facets.genres).toEqual(["Action", "RPG"]);
  });
});
