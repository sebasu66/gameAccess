import { describe, expect, it } from "vitest";
import { buildTasteProfile, gameTraits, tailorCatalog, tasteProgressText, tasteScore } from "./tasteProfile";
import type { CatalogGame } from "./types";

const game = (id: number, genres: string[], tags: string[] = []) => ({ id, name: `G${id}`, genres, tags }) as CatalogGame;
const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`;

// Likes: roguelikes. Dislikes: sports.
const liked = [game(1, ["Action"], ["Roguelike"]), game(2, ["Indie"], ["Roguelike"]), game(3, ["Action"], ["Roguelike", "Pixel Graphics"])];
const disliked = [game(4, ["Sports"], ["Football"]), game(5, ["Sports"], ["Racing"]), game(6, ["Sports", "Action"], [])];
const ratings = { 1: 1, 2: 1, 3: 1, 4: -1, 5: -1, 6: -1 } as Record<number, 1 | -1>;

describe("taste profile", () => {
  it("describes a game by genres, tags, categories and developers", () => {
    expect(gameTraits({ genres: ["Action"], tags: ["Co-op"], categories: ["Single-player"], developers: ["Valve"] }))
      .toEqual(["genre:action", "tag:co-op", "category:single-player", "developer:valve"]);
  });

  it("is not ready before three examples on each side", () => {
    const profile = buildTasteProfile({ 1: 1, 2: 1, 4: -1 }, [...liked, ...disliked], {});
    expect(profile.ready).toBe(false);
    expect(tasteProgressText(profile, profile, t as never)).toContain("tasteNeedMore");
  });

  it("finds what the likes and the dislikes have in common", () => {
    const profile = buildTasteProfile(ratings, [...liked, ...disliked], {});
    expect(profile.ready).toBe(true);
    expect(profile.certainty).toBeGreaterThanOrEqual(0.6);
    expect(profile.traits.find(trait => trait.key === "tag:roguelike")?.weight).toBe(1);
    expect(profile.traits.find(trait => trait.key === "genre:sports")?.weight).toBe(-1);
    // "Action" is in two likes and one dislike: not part of the taste.
    expect(profile.traits.some(trait => trait.key === "genre:action")).toBe(false);
    expect(tasteScore(profile, game(9, ["Indie"], ["Roguelike"]))).toBeGreaterThan(0);
    expect(tasteScore(profile, game(10, ["Sports"]))).toBeLessThan(0);
    expect(tasteProgressText(buildTasteProfile({}, [], {}), profile, t as never)).toContain("tasteReadyLikes");
  });

  it("sinks what looks like the dislikes and fills the hole with a match for the likes", () => {
    const profile = buildTasteProfile(ratings, [...liked, ...disliked], {});
    const list = [game(20, ["Puzzle"]), game(21, ["Sports"]), game(22, ["Puzzle"]), game(23, ["Indie"], ["Roguelike"])];
    expect(tailorCatalog(list, ratings, profile).map(item => item.id)).toEqual([20, 23, 22, 21]);
  });

  it("before it is ready, only the disliked games go down", () => {
    const few = { 21: -1 } as Record<number, 1 | -1>;
    const profile = buildTasteProfile(few, [], {});
    const list = [game(20, ["Puzzle"]), game(21, ["Sports"]), game(22, ["Sports"])];
    expect(tailorCatalog(list, few, profile).map(item => item.id)).toEqual([20, 22, 21]);
  });
});
