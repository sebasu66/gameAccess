import { describe, expect, it } from "vitest";
import { pickBestSource, sourceScore, type CheckedSource } from "./sourceRescue";
import type { PluginSource } from "./catalog/PluginSources";

const source = (title: string) => ({ title, url: `magnet:?xt=urn:btih:${title}`, type: "torrent", size: "", score: 0, pluginName: "p", sourceName: title }) as PluginSource;
const checked = (title: string, health: CheckedSource["health"]): CheckedSource => ({ source: source(title), health });

describe("try another source", () => {
  it("picks the torrent with the most seeds, then peers", () => {
    const best = pickBestSource([
      checked("few", { kind: "torrent", reachable: true, seeds: 2, peers: 400 }),
      checked("many", { kind: "torrent", reachable: true, seeds: 9, peers: 20 }),
      checked("dead", { kind: "torrent", reachable: false, seeds: 0, peers: 0 }),
    ]);
    expect(best?.source.title).toBe("many");
  });

  it("does not trust a torrent without seeds, and says none when nothing works", () => {
    expect(sourceScore({ kind: "torrent", reachable: true, seeds: 0, peers: 50 })).toBe(0);
    expect(pickBestSource([checked("leech", { kind: "torrent", reachable: true, seeds: 0, peers: 50 })])).toBeNull();
  });

  it("counts a direct link that answers below any seeded torrent", () => {
    const best = pickBestSource([
      checked("link", { kind: "direct", reachable: true, seeds: 0, peers: 0 }),
      checked("seeded", { kind: "torrent", reachable: true, seeds: 1, peers: 0 }),
    ]);
    expect(best?.source.title).toBe("seeded");
    expect(pickBestSource([checked("link", { kind: "direct", reachable: true, seeds: 0, peers: 0 })])?.source.title).toBe("link");
  });
});
