import { describe, expect, it } from "vitest";
import { enoughSignals, matchSuggested, pickOffered, resolveSuggestions, tasteSignals, type TasteSignals } from "./aiSuggestions";
import type { CatalogGame } from "./types";

const game = (id: number, name: string, app_id = id + 1000) => ({ id, name, app_id, genres: ["Action"] }) as unknown as CatalogGame;
const empty: TasteSignals = { liked: [], disliked: [], library: [], played: [] };

describe("AI suggestions", () => {
  it("reads the player's signals by name", () => {
    const signals = tasteSignals({ 1: 1, 2: -1, 3: 1 }, { 1: "Portal 2", 2: "FIFA 23" }, [game(9, "Hades", 50)], { 50: 10, 77: 5 });
    expect(signals).toMatchObject({ liked: ["Portal 2"], disliked: ["FIFA 23"], library: ["Hades"], played: ["Hades"] });
    expect(enoughSignals(signals)).toBe(false);
    expect(enoughSignals({ ...signals, library: ["A", "B", "C"] })).toBe(true);
    expect(enoughSignals({ ...empty, disliked: ["A", "B", "C", "D", "E"] })).toBe(false);
  });

  it("matches a suggested name to the catalog game", () => {
    const found = [game(1, "Portal 2 Soundtrack"), game(2, "Portal 2"), game(3, "Hades II")];
    expect(matchSuggested("Portal 2", found)?.id).toBe(2);
    expect(matchSuggested("hades ii", found)?.id).toBe(3);
    expect(matchSuggested("Celeste", found)).toBeNull();
  });

  it("uses the Steam id only when its game has the suggested name, and drops known games", async () => {
    const catalog = [game(1, "Celeste", 504230), game(2, "Hollow Knight", 367520), game(3, "Hades", 1145360)];
    const query = async (params: { query?: string; app_ids?: number[] }) => ({
      items: params.app_ids ? catalog.filter(item => params.app_ids!.includes(item.app_id!)) : catalog.filter(item => item.name.toLowerCase().includes((params.query ?? "").toLowerCase())),
    });
    const answer = { games: [
      { name: "Celeste", steam_app_id: 504230, why: "Like Hades." },
      { name: "Hollow Knight", steam_app_id: 504230, why: "Wrong id, right name." },
      { name: "Hades", steam_app_id: 1145360, why: "Already owned." },
      { name: "Made Up Game", why: "Not there." },
      { name: "Celeste", why: "Twice." },
      { name: "No reason" },
    ] };
    const picks = await resolveSuggestions(answer, { ...empty, library: ["Hades"] }, query);
    expect(picks.map(pick => pick.game.id)).toEqual([1, 2]);
    expect(picks[0].why).toBe("Like Hades.");
  });

  it("keeps only offered games, once, with a reason", () => {
    const offered = [game(1, "A"), game(2, "B")];
    const picks = pickOffered({ picks: [{ id: 2, why: "x" }, { id: 2, why: "y" }, { id: 9, why: "z" }, { id: 1, why: "" }] }, offered, 3);
    expect(picks.map(pick => [pick.game.id, pick.why])).toEqual([[2, "x"]]);
  });


});
