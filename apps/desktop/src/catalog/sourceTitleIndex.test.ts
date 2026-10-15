import { describe, expect, it } from "vitest";
import { gamesWithPossibleSources } from "./sourceTitleIndex";
import type { CatalogGame } from "../types";

const game = (id: number, name: string) => ({ id, app_id: id, name }) as unknown as CatalogGame;

describe("gamesWithPossibleSources", () => {
  const games = [game(1, "Magicka"), game(2, "Portal"), game(3, "Portal 2"), game(4, "Hades"), game(5, "Cyberpunk 2077")];
  it("keeps only games whose name starts a source title", () => {
    const result = gamesWithPossibleSources(["Magicka (v1.0) [FitGirl Repack]", "Portal 2 - Deluxe", "Unrelated Thing"], games);
    expect(result.map(g => g.id)).toEqual([1, 2, 3]);
  });
  it("ignores repacker prefixes and keeps catalog order", () => {
    const result = gamesWithPossibleSources(["fitgirl Hades v1.2", "Cyberpunk 2077 Ultimate"], games);
    expect(result.map(g => g.id)).toEqual([4, 5]);
  });
  it("returns nothing for an empty source list", () => {
    expect(gamesWithPossibleSources([], games)).toEqual([]);
  });
  it("ignores case and repeated spaces, and reads inner capitals both ways", () => {
    const list = [game(1, "Gunman Reborn"), game(2, "GunMan Chronicles"), game(3, "Dead Space")];
    const result = gamesWithPossibleSources(["gunman  reborn Free Download", "GUNMAN   CHRONICLES v1", "DeadSpace Free Download"], list);
    expect(result.map(g => g.id)).toEqual([1, 2, 3]);
  });
});
