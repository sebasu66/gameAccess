import { describe, expect, it } from "vitest";
import { duplicateRows, suggest, tokens } from "./matching";
import type { CatalogGame } from "../types";

const catalog = [{ id: 1, name: "The Quarry" }, { id: 2, name: "Quarry Quest" }, { id: 3, name: "ELDEN RING" }, { id: 4, name: "Portal 2" }] as unknown as CatalogGame[];

describe("matching folder names to catalog games", () => {
  it("drops repack noise, versions and build numbers", () => {
    expect(tokens("The.Quarry.Build.31012023-OFME")).toEqual(["quarry"]);
    expect(tokens("Elden Ring v1.10.1 [FitGirl Repack]")).toEqual(["elden", "ring"]);
  });
  it("ranks the exact game first and ignores unrelated ones", () => {
    expect(suggest("The.Quarry-OFME", catalog)[0]).toMatchObject({ id: 1 });
    expect(suggest("Portal 2", catalog).map(match => match.id)).toEqual([4]);
    expect(suggest("Totally Different", catalog)).toEqual([]);
  });
});

describe("the same game found twice", () => {
  it("lets only the first one in the list be imported", () => {
    const repeated = duplicateRows([
      { id: "a", path: "D:/SteamLibrary/Half", choice: 100 },
      { id: "b", path: "E:/Games/Half", choice: 100 },
      { id: "c", path: "E:/Games/Other", choice: 7 },
      { id: "d", path: "E:/Games/Loose", choice: null },
      { id: "e", path: "F:/Games/Half", choice: 100, duplicateOf: "D:/SteamLibrary/Half" },
    ]);
    expect([...repeated]).toEqual([["b", "D:/SteamLibrary/Half"], ["e", "D:/SteamLibrary/Half"]]);
  });
});
