import { describe, expect, it } from "vitest";
import { buildTasteProfile, gameTraits, likeChance, tailorCatalog, tasteProgressText, tasteQuery, tasteScore } from "./tasteProfile";
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

  it("gives each game a chance of pleasing: neutral at 0.5, up with liked traits, down with disliked ones", () => {
    const profile = buildTasteProfile(ratings, known, {});
    expect(likeChance(profile, noMansSky, ratings)).toBe(0.5);
    expect(likeChance(profile, game(24, ["Indie", "RPG"]), ratings)).toBeGreaterThan(0.8);
    expect(likeChance(profile, game(23, ["Anime", "Casual"]), ratings)).toBeLessThan(0.2);
    expect(likeChance(profile, disliked[0], ratings)).toBe(0);
    expect(likeChance(buildTasteProfile({ 1: 1 }, known, {}), game(24, ["Indie", "RPG"]), {})).toBe(0.5);
  });

  it("keeps the screen when nothing is much more likely, and adds the top below it", () => {
    const profile = buildTasteProfile(ratings, known, {});
    const list = [noMansSky, gta, game(30, ["Strategy"]), game(31, ["Racing"])];
    expect(tailorCatalog(list, ratings, profile, { screen: list.slice(0, 2) }).map(item => item.id)).toEqual([20, 21, 30, 31]);
    const candidates = [game(24, ["Indie", "RPG"])];
    // A strong candidate takes the first neutral place on screen; the neutral game moves to its rank, not to the end.
    expect(tailorCatalog(list, ratings, profile, { screen: list.slice(0, 2), candidates }).map(item => item.id)).toEqual([24, 21, 20, 30, 31]);
  });

  it("orders below the screen: top, neutral in their usual order, leaning to dislikes, disliked last", () => {
    const profile = buildTasteProfile(ratings, known, {});
    const list = [game(23, ["Anime", "Casual"]), noMansSky, disliked[1], gta, game(24, ["Indie", "RPG"])];
    expect(tailorCatalog(list, ratings, profile).map(item => item.id)).toEqual([24, 20, 21, 23, 5]);
  });

  it("before it is ready, only the disliked games go down (from the screen too)", () => {
    const few = { 21: -1 } as Record<number, 1 | -1>;
    const profile = buildTasteProfile(few, [], {});
    const list = [noMansSky, gta, game(23, ["Anime"]), game(24, ["RPG"])];
    // The disliked game's place on screen goes to the next game below it.
    expect(tailorCatalog(list, few, profile, { screen: list.slice(0, 3) }).map(item => item.id)).toEqual([20, 24, 23, 21]);
  });

  it("asks the database for liked genres without the disliked ones, inside the player's own filters", () => {
    const genreProfile = buildTasteProfile(ratings, [], {
      1: ["genre:rpg", "genre:indie"], 2: ["genre:rpg"], 3: ["genre:rpg", "genre:indie"],
      4: ["genre:casual"], 5: ["genre:casual", "genre:puzzle"], 6: ["genre:casual", "genre:puzzle"],
    });
    const base = { query: "dragon", sort_by: "steam-popularity", exclude_genres: ["Racing"] };
    expect(tasteQuery(genreProfile, base, ["RPG", "Indie", "Casual", "Puzzle"])).toMatchObject({
      query: "dragon", genres: ["RPG", "Indie"], exclude_genres: ["Racing", "Casual", "Puzzle"],
    });
    expect(tasteQuery(genreProfile, { genres: ["Indie"] }, ["RPG", "Indie"])?.genres).toEqual(["Indie"]);
    expect(tasteQuery(genreProfile, { genres: ["Racing"] }, [])).toBeNull();
    expect(tasteQuery(buildTasteProfile({}, [], {}), base, [])).toBeNull();
  });
});
