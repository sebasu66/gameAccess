import { describe, expect, it } from "vitest";
import { wideGames } from "./KidScreen";
import type { KidGame } from "./kidMode";

const game = (appId: number, featured = false): KidGame => ({ appId, name: String(appId), folder: "", executable: "", arguments: [], steam: true, featured });
const eight = [1, 2, 3, 4, 5, 6, 7, 8].map(id => game(id));

describe("pantalla del niño: qué juegos van grandes (apaisados)", () => {
  it("lo que el niño jugó esta semana primero, después los destacados del padre; un cuarto de los juegos", () => {
    const games = eight.map(item => item.appId === 6 ? game(6, true) : item);
    expect([...wideGames(games, [3, 99])]).toEqual([3, 6]);
  });

  it("sin datos elige algunos al azar, los mismos todo el día", () => {
    const today = wideGames(eight, [], "2026-10-31");
    expect(today.size).toBe(2);
    expect([...wideGames(eight, [], "2026-10-31")]).toEqual([...today]);
  });

  it("con menos de tres juegos no agranda ninguno", () => {
    expect(wideGames([game(1, true), game(2)], [1]).size).toBe(0);
  });
});
