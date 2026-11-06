import { describe, expect, it } from "vitest";
import { isSteamOwned, steamOwnerLabel } from "./steamLibrary";
import { libraryMembership } from "./libraryMembership";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import type { CatalogGame } from "./types";

const row = (extra: Partial<LibraryGame>) => ({ app_id: 10, name: "Alpha", state: "linked", link_kind: "steam", installed: true, ...extra }) as LibraryGame;

describe("Steam library", () => {
  it("only an owned, not installed Steam game is installed through Steam", () => {
    expect(isSteamOwned(row({ state: "steam_owned", installed: false }))).toBe(true);
    expect(isSteamOwned(row({}))).toBe(false);
    expect(isSteamOwned(row({ state: "steam_owned", link_kind: "folder" }))).toBe(false);
    expect(isSteamOwned(undefined)).toBe(false);
  });

  it("names the owner by its display name and account", () => {
    expect(steamOwnerLabel({ id64: "1", account: "acc", persona: "Big One", remembered: true })).toBe("Big One (acc)");
    expect(steamOwnerLabel({ id64: "1", account: "acc", persona: "acc", remembered: true })).toBe("acc");
    expect(steamOwnerLabel({ id64: "765", account: "", persona: "", remembered: false })).toBe("765");
    expect(steamOwnerLabel(undefined)).toBe("");
  });

  it("adds many games at once without repeating the ones already there", () => {
    const before = libraryMembership.getGames().length;
    const games = [{ id: 9001, app_id: 9001, name: "A" }, { id: 9002, app_id: 9002, name: "B" }, { id: 9001, app_id: 9001, name: "A again" }] as CatalogGame[];
    libraryMembership.addMany(games);
    libraryMembership.addMany(games);
    expect(libraryMembership.getGames().length).toBe(before + 2);
    games.forEach(game => libraryMembership.remove(game));
  });
});
