import { describe, expect, it } from "vitest";
import { describeProfile, EMPTY_PROFILE, profileSignature, type AiProfile } from "./aiProfile";
import { askPrompt, belowMinScore, enoughSignals, resolveSuggestions, signalsSignature, type TasteSignals } from "./aiSuggestions";
import type { CatalogGame } from "./types";

const game = (id: number, name: string, app_id: number, score?: number) => ({ id, name, app_id, steam_review_score: score }) as unknown as CatalogGame;
const profile: AiProfile = { genres: { rpg: 1, puzzle: -1 }, play: "multi", modes: ["coop", "pvp"], positive: "big worlds", negative: "low scores, anime aesthetics" };
const signals: TasteSignals = { liked: ["Solasta"], disliked: ["FIFA 23"], library: ["Skyrim"], played: [], profile };

describe("AI profile", () => {
  it("says only what the player filled in", () => {
    expect(describeProfile(EMPTY_PROFILE)).toEqual([]);
    const lines = describeProfile(profile).join("\n");
    expect(lines).toContain("Prefers: multiplayer");
    expect(lines).toContain("co-op; PvP");
    expect(lines).toContain("big worlds");
    expect(lines).toContain("low scores, anime aesthetics");
    expect(lines).toMatch(/Liked genres: .+/);
    expect(lines).toMatch(/Disliked genres: .+/);
  });

  it("leaves the multiplayer modes out for a single player", () => {
    expect(describeProfile({ ...profile, play: "single" }).join("\n")).not.toContain("co-op");
  });

  it("changes the saved answers' key when the profile changes", () => {
    expect(signalsSignature(signals)).not.toBe(signalsSignature({ ...signals, profile: { ...profile, negative: "" } }));
    expect(profileSignature(EMPTY_PROFILE)).toBe("[]");
  });

  it("counts marked genres towards suggestions", () => {
    const genres = { rpg: 1, puzzle: 1, racing: 1, sports: -1, horror: -1 } as AiProfile["genres"];
    expect(enoughSignals({ liked: [], disliked: [], library: [], played: [], profile: { ...EMPTY_PROFILE, genres } })).toBe(true);
  });

  it("sends the request, the profile and the rules", () => {
    const prompt = askPrompt("co-op tactics", signals);
    expect(prompt).toContain('"co-op tactics"');
    expect(prompt).toContain("Solasta");
    expect(prompt).toContain("low scores, anime aesthetics");
    expect(prompt).toContain("at least 30");
    expect(prompt).toContain("65%");
    expect(askPrompt("  ", signals)).toContain("go by their profile");
  });

  it("drops low scores and keeps games with no score", () => {
    expect(belowMinScore(game(1, "A", 1, 40))).toBe(true);
    expect(belowMinScore(game(2, "B", 2, 65))).toBe(false);
    expect(belowMinScore(game(3, "C", 3))).toBe(false);
    expect(belowMinScore(game(4, "D", 4, 0))).toBe(false);
  });

  it("goes by the name when the AI's Steam id is another game's", async () => {
    const catalog = [game(1, "Control", 870780), game(2, "Satisfactory", 526870)];
    const query = async (params: { query?: string; app_ids?: number[] }) => ({
      items: params.app_ids ? catalog.filter(item => params.app_ids!.includes(item.app_id!)) : catalog.filter(item => item.name.includes(params.query ?? "")),
    });
    const picks = await resolveSuggestions({ games: [{ name: "Satisfactory", steam_app_id: 870780, why: "Like Manor Lords." }] }, signals, query as never, 40);
    expect(picks.map(pick => pick.game.id)).toEqual([2]);
  });
});
