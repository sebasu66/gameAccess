vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkPluginSources, getPluginSources, sourceAvailability, applySourceAvailability, preparePluginSource } from "./PluginSources";
import { pluginDownloadLabel } from "../PluginDownloadButton";
import type { CatalogGame } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const game = { id: 7, app_id: 700, name: "Example", slug: "example", credit_cost_per_hour: 0, copies_total: 0, copies_available: 0 } satisfies CatalogGame;
const plugin = { id: "test", name: "Provider", type: "source_provider", endpoint: "http://127.0.0.1:45000/" };
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(invoke).mockReset(); });
describe("External plugin sources", () => {
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
  it("supports named feeds and immutable catalog updates", async () => {
    vi.mocked(invoke).mockResolvedValue([plugin]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ 700: { count: 3, sources: ["Feed A", "Feed B"] } }) }));
    expect(await checkPluginSources([game])).toEqual({ 700: 3 });
    const original = [game];
    const next = applySourceAvailability(original);
    expect(next).not.toBe(original); expect(next[0]).not.toBe(game);
    expect(next[0].download_source_names).toEqual(["Feed A", "Feed B"]);
    expect(applySourceAvailability(next)).toBe(next);
  });
  it("publishes the first batch before the full catalog scan finishes", async () => {
    vi.mocked(invoke).mockResolvedValue([plugin]);
    let resolveLast!: (value: unknown) => void;
    const last = new Promise(resolve => { resolveLast = resolve; });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ok:true,json:async()=>({800:{count:2,sources:["Feed A"]}})})
      .mockImplementationOnce(()=>last));
    const games = Array.from({length:101},(_,index)=>({...game,id:800+index,app_id:800+index,name:"Game "+index}));
    const request = checkPluginSources(games);
    await vi.waitFor(()=>expect(sourceAvailability(games[0]).count).toBe(2));
    resolveLast({ok:true,json:async()=>({900:{count:1,sources:["Feed B"]}})});
    await request;
    expect(sourceAvailability(games[100]).names).toEqual(["Feed B"]);
  });
  it("a failed provider disables current availability", async () => {
    vi.mocked(invoke).mockResolvedValue([plugin]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getPluginSources(game)).toEqual([]);
    expect(sourceAvailability(game).count).toBe(0);
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
    expect(fetcher.mock.calls[1][0]).toBe(plugin.endpoint+"api/prepare/abc");
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
