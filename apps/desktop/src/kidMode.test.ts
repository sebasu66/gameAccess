import { describe, expect, it } from "vitest";
import type { AppShortcut } from "./appShortcuts";
import { applyKidDraft, dropKidGames, kidGameCount, kidGamesAmong, NEW_KID, resetKidMode, setKidDraft, toggleKidShortcut } from "./kidMode";

const shortcut = (id: number, name: string) => ({ id, name, folder: "C:/x", target: "C:/x/a.exe", arguments: [] }) as unknown as AppShortcut;

describe("modo niño: juegos que salen de la biblioteca", () => {
  it("quita del niño solo los juegos que se van y dice cuántos le quedan", async () => {
    setKidDraft({ name: "Juan", games: [] });
    toggleKidShortcut(shortcut(1, "Roblox"));
    toggleKidShortcut(shortcut(2, "Paint"));
    expect(kidGameCount()).toBe(2);
    expect(kidGamesAmong([-1, 99]).map(game => game.name)).toEqual(["Roblox"]);
    expect(dropKidGames([-1, 99]).map(game => game.name)).toEqual(["Roblox"]);
    expect(kidGameCount()).toBe(1);
    expect(dropKidGames([-1])).toEqual([]);
  });

  it("deshacer el modo niño vuelve todo a cero", async () => {
    setKidDraft({ name: "Juan", games: [] });
    toggleKidShortcut(shortcut(3, "Dibujo"));
    await applyKidDraft();
    await resetKidMode();
    expect(kidGameCount()).toBe(0);
    setKidDraft({});
    expect(NEW_KID.weekdays).toBe("12-21");
  });
});
