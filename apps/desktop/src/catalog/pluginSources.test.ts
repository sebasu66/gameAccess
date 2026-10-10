vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkPluginSources, getPluginSources, sourceAvailability, applySourceAvailability } from "./PluginSources";
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
  it("a failed provider disables current availability", async () => {
    vi.mocked(invoke).mockResolvedValue([plugin]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getPluginSources(game)).toEqual([]);
    expect(sourceAvailability(game).count).toBe(0);
  });
});
