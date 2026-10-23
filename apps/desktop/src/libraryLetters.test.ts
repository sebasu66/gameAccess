import { describe, expect, it } from "vitest";
import { findLibraryLetter } from "./librarySearch";
import { handleGridKey } from "./LibraryRoomParts";
import type { CatalogGame } from "./types";

const games = ["Alpha", "Doom", "Árbol", "Warframe", "Sonic"].map(name => ({ name }) as CatalogGame);
describe("library letters", () => {
  it("cycles matching initials and wraps, including accents and WASD", () => {
    expect(findLibraryLetter(games, "a", 0)).toBe(2);
    expect(findLibraryLetter(games, "A", 2)).toBe(0);
    expect(findLibraryLetter(games, "w", 0)).toBe(3);
    expect(findLibraryLetter(games, "s", 0)).toBe(4);
    expect(findLibraryLetter(games, "d", 0)).toBe(1);
    expect(findLibraryLetter(games, "z", 0)).toBe(-1);
  });
  it("reserves directional movement for arrows", () => {
    let delta = 0;
    const context = { selectedIndex: 1, columns: 3, enterActions: () => {}, moveGrid: (value: number) => { delta = value; } };
    for (const key of ["w", "a", "s", "d"]) expect(handleGridKey(key, context)).toBe(false);
    expect(delta).toBe(0);
    expect(handleGridKey("arrowdown", context)).toBe(true);
    expect(delta).toBe(3);
  });
});
