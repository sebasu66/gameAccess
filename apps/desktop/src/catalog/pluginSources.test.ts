vi.mock("../narrationLog", () => ({ narrate: vi.fn(), narrateBatch: vi.fn().mockResolvedValue(undefined) }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  checkPluginSources,
  invalidatePluginSources,
  getPluginSources,
  sourceAvailability,
  applySourceAvailability,
  preparePluginSource,
  unregisterPluginSources,
  getAllAvailableSourceNames,
  sourcePluginReady,
  pluginSyncLine,
} from "./PluginSources";
import { pollPluginRuntime, resetPluginRuntime } from "./PluginRuntime";
import { pluginDownloadLabel } from "../PluginDownloadButton";
import type { CatalogGame } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const game = { id: 7, app_id: 700, name: "Example", slug: "example", credit_cost_per_hour: 0, copies_total: 0, copies_available: 0 } satisfies CatalogGame;
const plugin = { id: "test", name: "Provider", type: "source_provider", endpoint: "http://127.0.0.1:45000/" };
beforeEach(() => {
  resetPluginRuntime();
  invalidatePluginSources();
  (globalThis as any).window = { __TAURI_INTERNALS__: {}, dispatchEvent: vi.fn() };
});
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(invoke).mockReset(); });
describe("plugin source-index log", () => {
  it("says what was asked, what came back and where the time went", () => {
    expect(pluginSyncLine("Torrent Source Provider", { since: "r26", revision: "r27", full: false, added: 12, removed: 3, fetchedMs: 140, totalMs: 1770 }))
      .toBe("Provider 'Torrent Source Provider' · source index: asked changes since revision r26, got a delta → revision r27 (+12 / -3 entries); request 140 ms, saving 1630 ms, total 1770 ms.");
    expect(pluginSyncLine("P", { since: "", revision: "r1", full: true, added: 40000, removed: 0, fetchedMs: 5000, totalMs: 9000 }))
      .toContain("asked the full index, got the full index");
  });
});

describe("External plugin sources", () => {
  it("syncs /api/source-index once per revision and sends ?since= on subsequent revisions", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_registered_plugins") return [plugin];
      if (cmd === "catalog_sources_apply") {
        return { plugin_id: plugin.id, revision: "1-0", sources_total: 2, matched_links: 2 };
      }
      return undefined;
    });

    const fetcher = vi.fn(async (url: string): Promise<any> => {
      if (url.endsWith("/api/health")) {
        return { ok: true, status: 200, json: async () => ({ id: plugin.id, revision: "1-0", instanceId: "i1", dirty: false }) };
      }
      if (url.endsWith("/api/source-index")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            revision: "1-0",
            full: true,
            added: [
              { key: "k1", title: "Example Repack", source: "Feed A", multiplayer: false },
              { key: "k2", title: "Example Online-Fix", source: "Feed B", multiplayer: true },
            ],
            removed: [] as string[],
          }),
        };
      }
      throw new Error("Unexpected URL: " + url);
    });
    vi.stubGlobal("fetch", fetcher);

    await pollPluginRuntime();
    await checkPluginSources();
    await checkPluginSources();

    const indexCalls = fetcher.mock.calls.filter(c => String(c[0]).includes("/api/source-index"));
    expect(indexCalls).toHaveLength(1);
    expect(indexCalls[0][0]).toBe("http://127.0.0.1:45000/api/source-index");
    expect(invoke).toHaveBeenCalledWith("catalog_sources_apply", {
      pluginId: "test",
      revision: "1-0",
      full: true,
      added: [
        { key: "k1", title: "Example Repack", source: "Feed A", multiplayer: false },
        { key: "k2", title: "Example Online-Fix", source: "Feed B", multiplayer: true },
      ],
      removed: [],
    });
    expect(getAllAvailableSourceNames()).toEqual(["Feed A", "Feed B"]);

    // Advance plugin revision to 2-0 and verify delta sync uses ?since=1-0
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/health")) {
        return { ok: true, status: 200, json: async () => ({ id: plugin.id, revision: "2-0", instanceId: "i1", dirty: false }) };
      }
      if (url.includes("/api/source-index?since=1-0")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            revision: "2-0",
            full: false,
            added: [{ key: "k3", title: "Another Game", source: "Feed C", multiplayer: false }],
            removed: ["k1"],
          }),
        };
      }
      throw new Error("Unexpected URL: " + url);
    });

    await pollPluginRuntime();
    await checkPluginSources();

    expect(invoke).toHaveBeenCalledWith("catalog_sources_apply", {
      pluginId: "test",
      revision: "2-0",
      full: false,
      added: [{ key: "k3", title: "Another Game", source: "Feed C", multiplayer: false }],
      removed: ["k1"],
    });
  });

  it("an old plugin without /api/source-index is reported (it must be updated) and nothing counts as synced", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "get_registered_plugins" ? [plugin] : undefined));
    vi.stubGlobal("fetch", vi.fn(async (url: string): Promise<any> => {
      if (url.endsWith("/api/health")) return { ok: true, status: 200, json: async () => ({ id: plugin.id, revision: "5-0" }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    await pollPluginRuntime();
    await expect(checkPluginSources()).rejects.toThrow(/Provider/);
    expect(invoke).not.toHaveBeenCalledWith("catalog_sources_apply", expect.anything());
    await expect(sourcePluginReady()).resolves.toBe(false);
  });

  it("uses the Steam AppID, rejects unusable URLs, deduplicates and keeps source-specific sizes", async () => {
    vi.mocked(invoke).mockResolvedValue([plugin]);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [
      { title: "Version A", url: "https://example.test/a.zip", size: "6 GB", score: 2, sourceName: "Feed A" },
      { title: "duplicate", url: "https://example.test/a.zip", size: "99 GB", score: 1 },
      { title: "invalid", url: "javascript:bad" },
    ] });
    vi.stubGlobal("fetch", fetcher);
    const result = await getPluginSources(game);
    expect(fetcher.mock.calls[0][0]).toContain("app_id=700");
    expect(result).toHaveLength(1);
    expect(sourceAvailability(game)).toEqual({ count: 1, names: ["Feed A"] });
    expect(pluginDownloadLabel(game, result, "es")).toBe("Descargar (6 GB) [1 fuente]");
    expect(pluginDownloadLabel(game, result, "en")).toBe("Download (6 GB) [1 source]");
  });

  it("preserves persistent SQLite availability when plugin is offline and updates on detail fetch", async () => {
    const dbGame: CatalogGame = {
      ...game,
      has_downloads: true,
      availableSourceCount: 2,
      download_source_names: ["FitGirl", "SteamRip"],
    };
    expect(sourceAvailability(dbGame)).toEqual({ count: 2, names: ["FitGirl", "SteamRip"] });
    const unchanged = [dbGame];
    expect(applySourceAvailability(unchanged)).toBe(unchanged);

    // If plugin is offline, getPluginSources returns [] for live links, but persistent DB availability on dbGame remains intact
    vi.mocked(invoke).mockResolvedValue([plugin]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getPluginSources(dbGame)).toEqual([]);
    expect(sourceAvailability(dbGame)).toEqual({ count: 2, names: ["FitGirl", "SteamRip"] });
    expect(sourceAvailability(game).count).toBe(0);
  });

  it("removes plugin sources from SQLite when unregisterPluginSources is called", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await unregisterPluginSources("test");
    expect(invoke).toHaveBeenCalledWith("catalog_sources_remove_plugin", { pluginId: "test" });
  });
});

describe("Plugin link preparation", () => {
  it("prepares through the registered plugin and passes the actual file URL", async () => {
    vi.mocked(invoke).mockResolvedValue([plugin]);
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ok:true,json:async()=>[{title:"Fixture",url:"https://gofile.io/d/ABC",resolverUrl:plugin.endpoint+"api/prepare/abc",size:"6 GB"}]})
      .mockResolvedValueOnce({ok:true,json:async()=>({url:plugin.endpoint+"api/download/abc/fixture.zip",mode:"proxy"})});
    vi.stubGlobal("fetch", fetcher);
    const [source] = await getPluginSources(game);
    const prepared = await preparePluginSource(source);
    expect(String(fetcher.mock.calls[1][0]).split("?")[0]).toBe(plugin.endpoint + "api/prepare/abc");
    expect(prepared.url).toBe(plugin.endpoint+"api/download/abc/fixture.zip");
  });
  it("does not silently download a landing page when resolution fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:false,json:async()=>({error:"Gofile: error-notFound"})}));
    await expect(preparePluginSource({title:"Fixture",url:"https://gofile.io/d/missing",resolverUrl:plugin.endpoint+"api/prepare/missing",type:"http",size:"",score:1,pluginName:"Provider",sourceName:"Feed"})).rejects.toThrow("error-notFound");
  });
  it("ignores a resolver outside the registered provider origin", async () => {
    vi.mocked(invoke).mockResolvedValue([plugin]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async()=>[{url:"https://example.test/fixture.zip",resolverUrl:"https://unexpected.test/resolve"}]}));
    const [source] = await getPluginSources(game);
    expect(source.resolverUrl).toBeUndefined();
  });
});

describe("Download source transport", () => {
  it("rejects incomplete magnets and accepts hexadecimal, base32 and v2 identities", async () => {
    vi.mocked(invoke).mockResolvedValue([plugin]);
    const urls = ["magnet:?dn=missing", "magnet:?xt=urn:btih:bad",
      "magnet:?xt=urn:btih:" + "a".repeat(40), "magnet:?xt=urn:btih:" + "A".repeat(32),
      "magnet:?xt=urn:btmh:1220" + "b".repeat(64)];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async()=>urls.map(url=>({url}))}));
    expect((await getPluginSources(game)).map(source=>source.url)).toEqual(urls.slice(2));
  });
  it("preserves browser delivery returned by the resolver", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async()=>({url:"https://example.test/page",mode:"browser"})}));
    const source = {title:"Fixture",url:"https://example.test/page",resolverUrl:plugin.endpoint+"api/prepare/page",type:"http",size:"",score:1,pluginName:"Provider",sourceName:"Feed"};
    expect((await preparePluginSource(source)).delivery).toBe("browser");
  });
});

it("preserves provider ranking instead of promoting a small higher-score supplement", async () => {
  vi.mocked(invoke).mockResolvedValue([plugin]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async()=>[
    {title:"Full package",url:"https://example.test/game.zip",size:"45 GB",score:0.9},
    {title:"Supplement",url:"https://example.test/fix.zip",size:"37 MB",score:1},
  ]}));
  const sources = await getPluginSources(game);
  expect(sources.map(item=>item.title)).toEqual(["Full package","Supplement"]);
  expect(pluginDownloadLabel(game,sources,"es")).toContain("45 GB");
});
