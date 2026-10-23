import { describe, expect, it } from "vitest";
import { gamePassesQualityFilters, MIN_REVIEWS_TO_JUDGE } from "./libraryQuality";
import { INITIAL_LIBRARY_FILTERS, DEFAULT_LIBRARY_FILTERS } from "./librarySearch";
import type { CatalogGame } from "./types";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const make = (extra: Partial<CatalogGame>) => ({ id: 1, name: "G", ...extra }) as unknown as CatalogGame;
const pass = (game: CatalogGame) => gamePassesQualityFilters(game, INITIAL_LIBRARY_FILTERS, NOW);

describe("default score filter spares games that cannot be judged yet", () => {
  it("hides an established, badly reviewed game", () => {
    expect(pass(make({ steam_review_score: 40, steam_review_count: 500, release_date: "2020-05-01" }))).toBe(false);
  });
  it("keeps a good game", () => {
    expect(pass(make({ steam_review_score: 85, steam_review_count: 500, release_date: "2020-05-01" }))).toBe(true);
  });
  it("keeps a badly scored game released in the last month", () => {
    expect(pass(make({ steam_review_score: 30, steam_review_count: 200, release_date: "2026-10-01" }))).toBe(true);
  });
  it("keeps a badly scored game with too few reviews", () => {
    expect(pass(make({ steam_review_score: 20, steam_review_count: MIN_REVIEWS_TO_JUDGE - 1, release_date: "2020-05-01" }))).toBe(true);
  });
  it("keeps a game with no score", () => {
    expect(pass(make({ release_date: "2020-05-01" }))).toBe(true);
  });
  it("stays strict when the grace is not requested", () => {
    expect(gamePassesQualityFilters(make({ release_date: "2020-05-01" }), { ...DEFAULT_LIBRARY_FILTERS, minReviewScore: 60 }, NOW)).toBe(false);
  });
});
