vi.mock("./PluginSources", () => ({
  checkPluginSources: vi.fn(),
  getPluginSources: vi.fn(),
  preparePluginSource: vi.fn(async (source: { title: string }) => { throw new Error("picked " + source.title); }),
}));
import { describe, expect, it, vi } from "vitest";
import { DigitalCatalog } from "./DigitalCatalog";
import { getPluginSources, type PluginSource } from "./PluginSources";
import { translate } from "../i18n";
import type { CatalogGame } from "../types";

const game = { id: 5, app_id: 5, name: "Five", slug: "five", credit_cost_per_hour: 0, copies_total: 0, copies_available: 0 } satisfies CatalogGame;
const source = (title: string, marked: boolean): PluginSource => ({ title, url: "magnet:?xt=urn:btih:" + title.padEnd(40, "0"), type: "torrent", size: "1 GB",
  score: 0, pluginName: "P", sourceName: "P", ...(marked ? { lesson: { scope: "source", subject: "x", reason: "not_a_game", action: "avoid", reports: 2,
    confidence: "flagged", first_seen: "", last_seen: "" } } : {}) } as PluginSource);

describe("the default download and what players learned", () => {
  const service = new DigitalCatalog({ isInstalledHandler: async () => false });

  it("skips a source marked as not a game", async () => {
    vi.mocked(getPluginSources).mockResolvedValue([source("a", true), source("b", false)]);
    await expect(service.download(game)).rejects.toThrow("picked b");
  });

  it("starts nothing by default when every source is marked; an explicit choice still can", async () => {
    vi.mocked(getPluginSources).mockResolvedValue([source("a", true)]);
    await expect(service.download(game)).rejects.toThrow(translate("sourcesAllMarked"));
    await expect(service.download(game, source("a", true))).rejects.toThrow("picked a");
  });
});
