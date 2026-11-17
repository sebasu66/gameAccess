import { describe, expect, it } from "vitest";
import { rankSources, titleVersion } from "./sourceRanking";

// What the installed Source Manager answered for ELDEN RING (AppID 1245620) on 2026-10-22, in its order.
const ELDEN_RING = [
  ["onlinefix", "69.5 GB", "Elden Ring 1.17"],
  ["onlinefix", "69.3 GB", "Elden Ring 1.16.2"],
  ["onlinefix", "67.4 GB", "Elden Ring 1.14.1"],
  ["onlinefix", "67.3 GB", "Elden Ring 1.12.3"],
  ["pcgamestorrent", "47.18 GB", "ELDEN RING v1 09-Razor1911"],
  ["SteamRip", "67.4 GB", "Elden Ring Deluxe Edition Free Download (v1.17)"],
  ["SteamGG", "68.41 GB", "Elden Ring Deluxe Edition Free Download [Tarnished Pack/All DLCs/Build-23850278]"],
  ["SteamRip", "67 GB", "Elden Ring Deluxe Edition Free Download (v1.16.1)"],
  ["pcgamestorrent", "21.96 MB", "ELDEN RING - Update Only v1.10"],
  ["pcgamestorrent", "31.51 MB", "ELDEN RING - Update Only v1.09.1"],
].map(([sourceName, size, title]) => ({ sourceName, size, title, score: 0.9 }));

describe("download option order", () => {
  it("reads the versions in real release titles", () => {
    expect(titleVersion("Elden Ring 1.16.2")).toEqual([1, 16, 2]);
    expect(titleVersion("Elden Ring Deluxe Edition Free Download (v1.17)")).toEqual([1, 17]);
    expect(titleVersion("ELDEN RING v1 09-Razor1911")).toEqual([1, 9]);
    expect(titleVersion("Elden Ring Deluxe Edition [Tarnished Pack/All DLCs/Build-23850278]")).toBeNull();
  });

  it("Online-Fix first, then the newest version anywhere, patches last", () => {
    const order = rankSources(ELDEN_RING).map(s => `${s.sourceName}: ${s.title}`);
    expect(order.slice(0, 4)).toEqual([
      "onlinefix: Elden Ring 1.17", "onlinefix: Elden Ring 1.16.2", "onlinefix: Elden Ring 1.14.1", "onlinefix: Elden Ring 1.12.3"]);
    expect(order[4]).toBe("SteamRip: Elden Ring Deluxe Edition Free Download (v1.17)");
    expect(order[5]).toBe("SteamRip: Elden Ring Deluxe Edition Free Download (v1.16.1)");
    expect(order.slice(-2)).toEqual(["pcgamestorrent: ELDEN RING - Update Only v1.10", "pcgamestorrent: ELDEN RING - Update Only v1.09.1"]);
  });

  it("without Online-Fix the newest version leads even when an old one scored higher", () => {
    const others = ELDEN_RING.filter(s => s.sourceName !== "onlinefix").map((s, i) => ({ ...s, score: i === 0 ? 5 : 0.9 }));
    expect(rankSources(others)[0].title).toBe("Elden Ring Deluxe Edition Free Download (v1.17)");
  });
});
