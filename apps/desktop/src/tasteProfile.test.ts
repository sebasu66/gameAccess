import { describe, expect, it } from "vitest";
import { buildTasteProfile, gameTraits, tailorCatalog, tasteProgressText, tasteScore } from "./tasteProfile";
import type { CatalogGame } from "./types";

const game = (id: number, tags: string[]) => ({ id, name: `G${id}`, tags }) as CatalogGame;
const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`;

// Likes: indie RPGs, co-op, a bit adult. Dislikes: anime, casual, puzzle.
const liked = [game(1, ["RPG", "Indie", "Co-op"]), game(2, ["RPG", "Indie", "Mature"]), game(3, ["RPG", "Co-op", "Indie"])];
const disliked = [game(4, ["Anime", "Casual"]), game(5, ["Puzzle", "Casual"]), game(6, ["Anime", "Puzzle", "Casual"])];
const ratings = { 1: 1, 2: 1, 3: 1, 4: -1, 5: -1, 6: -1 } as Record<number, 1 | -1>;
const known = [...liked, ...disliked];
const noMansSky = game(20, ["Adventure", "Survival", "Open World"]);
const gta = game(21, ["Action", "Open World", "Mature"]);

describe("taste profile", () => {
  it("describes a game by genres, tags, categories and developers", () => {
    expect(gameTraits({ genres: ["Action"], tags: ["Co-op"], categories: ["Single-player"], developers: ["Valve"] }))
      .toEqual(["genre:action", "tag:co-op", "category:single-player", "developer:valve"]);
  });

  it("keeps only clear patterns: a like does not make every other trait disliked", () => {
    const profile = buildTasteProfile(ratings, known, {});
    const weight = (key: string) => profile.traits.find(trait => trait.key === key)?.weight;
    expect(weight("tag:rpg")).toBe(1);
    expect(weight("tag:casual")).toBe(-1);
    expect(weight("tag:mature")).toBeUndefined(); // only one liked game has it
    expect(tasteScore(profile, noMansSky)).toBe(0);
    expect(tasteScore(profile, gta)).toBe(0);
    expect(tasteScore(profile, game(22, ["Anime", "Casual"]))).toBeLessThan(0);
  });

  it("is certain enough only when the profile predicts the player's own ratings", () => {
    const profile = buildTasteProfile(ratings, known, {});
    expect(profile.certainty).toBe(0.75);
    expect(profile.ready).toBe(true);
    expect(tasteProgressText(profile, t as never)).toBe('tasteReady{"percent":75}');
    const few = buildTasteProfile({ 1: 1, 2: 1, 4: -1, 5: -1 }, known, {});
    expect(few.ready).toBe(false);
    expect(tasteProgressText(few, t as never)).toContain("tasteProgress");
    // Likes and dislikes with nothing in common among themselves: no pattern, no certainty.
    const mixed = buildTasteProfile({ 1: 1, 4: 1, 20: 1, 2: -1, 5: -1, 21: -1 }, [...known, noMansSky, gta], {});
    expect(mixed.ready).toBe(false);
  });

  it("sinks only what leans to the dislikes, fills the hole with a match for the likes, leaves neutral games", () => {
    const profile = buildTasteProfile(ratings, known, {});
    const list = [noMansSky, game(23, ["Anime", "Casual"]), gta, game(24, ["Indie", "RPG"])];
    expect(tailorCatalog(list, ratings, profile).map(item => item.id)).toEqual([20, 24, 21, 23]);
  });

  it("before it is ready, only the disliked games go down", () => {
    const few = { 21: -1 } as Record<number, 1 | -1>;
    const profile = buildTasteProfile(few, [], {});
    const list = [noMansSky, gta, game(23, ["Anime"])];
    expect(tailorCatalog(list, few, profile).map(item => item.id)).toEqual([20, 23, 21]);
  });
});
