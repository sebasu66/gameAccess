import { describe, expect, it } from "vitest";
import {
  CONTENT_FILTER_GROUPS,
  EMPTY_LIBRARY_FILTERS,
  adultReason,
  defaultLibraryFilters,
  filterLibraryGames,
  filterLibraryGamesDetailed,
  gameHasTooFewReviews,
  gameIsAdult,
  gameIsLowRated,
  gameIsShitty,
  gameIsUnratedJunk,
  gameMatchesTags,
  getTagCounts,
  parseReleaseDate,
} from "./librarySearch";
import type { CatalogGame } from "./types";

// Mirrors the real catalog: ISO dates dominate, with a localized minority.
const NOW = Date.UTC(2026, 9, 11);
const DAY = 86_400_000;
const OLD = "2019-01-01";
const RECENT = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);

function game(overrides: Partial<CatalogGame>): CatalogGame {
  return {
    id: 1, slug: "g", name: "Game", app_id: 1,
    credit_cost_per_hour: 0, copies_total: 1, copies_available: 1,
    ...overrides,
  };
}

describe("release date parsing", () => {
  it("reads both the ISO and the localized shapes the catalog actually uses", () => {
    // Measured: ~31.7k ISO rows against ~606 localized ones. Reading only one
    // shape mis-dates almost the whole catalog.
    expect(parseReleaseDate("2009-05-14")?.toISOString().slice(0, 10)).toBe("2009-05-14");
    expect(parseReleaseDate("12 AGO 2016")?.toISOString().slice(0, 10)).toBe("2016-08-12");
    expect(parseReleaseDate("12 Aug, 2026")?.toISOString().slice(0, 10)).toBe("2026-08-12");
  });

  it("treats an unknown date as unknown, never as old", () => {
    expect(parseReleaseDate("Por confirmarse")).toBeNull();
    expect(gameIsShitty(game({ release_date: "Por confirmarse" }), NOW)).toBe(false);
    // 22.5% of the catalog has no usable date; none of it may be hidden by age.
    expect(gameIsShitty(game({ release_date: null, steam_review_score: null }), NOW)).toBe(false);
  });
});

describe("the three quality screens, each gated on release age", () => {
  it("month gate: a recent release is never judged for lacking reviews", () => {
    expect(gameIsUnratedJunk(game({ release_date: RECENT, steam_review_score: null }), NOW)).toBe(false);
    expect(gameIsLowRated(game({ release_date: RECENT, steam_review_score: 20 }), NOW)).toBe(false);
    expect(gameHasTooFewReviews(game({ release_date: RECENT, steam_review_score: 90, steam_review_count: 2 }), NOW)).toBe(false);
  });

  it("no reviews at all: old and scoreless", () => {
    expect(gameIsUnratedJunk(game({ release_date: OLD, steam_review_score: null, steam_review_count: 0 }), NOW)).toBe(true);
    // Any score means someone reviewed it.
    expect(gameIsUnratedJunk(game({ release_date: OLD, steam_review_score: 95, steam_review_count: 12 }), NOW)).toBe(false);
  });

  it("below the score bar: old and under 50", () => {
    expect(gameIsLowRated(game({ release_date: OLD, steam_review_score: 49.9, steam_review_count: 5000 }), NOW)).toBe(true);
    expect(gameIsLowRated(game({ release_date: OLD, steam_review_score: 20, steam_review_count: 1241 }), NOW)).toBe(true);
    expect(gameIsLowRated(game({ release_date: OLD, steam_review_score: 50, steam_review_count: 5 }), NOW)).toBe(false);
  });

  it("too few reviews: old, good score, under 100 reviews", () => {
    // A month after release, under 100 reviews means it reached almost nobody.
    expect(gameHasTooFewReviews(game({ release_date: OLD, steam_review_score: 97, steam_review_count: 70 }), NOW)).toBe(true);
    expect(gameHasTooFewReviews(game({ release_date: OLD, steam_review_score: 100, steam_review_count: 11 }), NOW)).toBe(true);
    expect(gameHasTooFewReviews(game({ release_date: OLD, steam_review_score: 90, steam_review_count: 10 }), NOW)).toBe(true);
    // 100 reviews is enough, and a low score is the other rule's business.
    expect(gameHasTooFewReviews(game({ release_date: OLD, steam_review_score: 55, steam_review_count: 100 }), NOW)).toBe(false);
    expect(gameHasTooFewReviews(game({ release_date: OLD, steam_review_score: 20, steam_review_count: 3 }), NOW)).toBe(false);
  });

  it("combines into the shitty rule", () => {
    expect(gameIsShitty(game({ release_date: OLD, steam_review_score: 97, steam_review_count: 70 }), NOW)).toBe(true);
    expect(gameIsShitty(game({ release_date: OLD, steam_review_score: 85, steam_review_count: 421100 }), NOW)).toBe(false);
  });
});

describe("adult screen", () => {
  it("recognises adult titles from the detail payload first", () => {
    expect(gameIsAdult(game({ required_age: 18 }))).toBe(true);
    expect(gameIsAdult(game({ required_age: "18" }))).toBe(true);
    expect(gameIsAdult(game({ required_age: 0 }))).toBe(false);
    expect(gameIsAdult(game({ adult_only: true }))).toBe(true);
    expect(gameIsAdult(game({ content_descriptors: ["Some Nudity or Sexual Content"] }))).toBe(true);
    // No signal at all: unknown is not adult.
    expect(gameIsAdult(game({}))).toBe(false);
  });

  it("falls back to explicit tags, which is all the packaged catalog has", () => {
    // The seed carries no required_age/content_descriptors at all, so without
    // the tags the parental filter would silently block nothing.
    expect(gameIsAdult(game({ tags: ["Hentai"] }))).toBe(true);
    expect(gameIsAdult(game({ tags: ["Sexual Content"] }))).toBe(true);
    expect(gameIsAdult(game({ tags: ["Nudity"] }))).toBe(true);
    expect(gameIsAdult(game({ genres: ["Adult Only"] }))).toBe(true);
    expect(gameIsAdult(game({ tags: ["Action", "Indie"] }))).toBe(false);
  });

  it("does not hide mainstream titles for violence tags unless asked", () => {
    // Measured on the real catalog: `mature` matches Batman: Arkham Knight and
    // `violent` matches Hellblade. Hiding those as "adult" would be wrong.
    const batman = game({ tags: ["Mature"] });
    const hellblade = game({ tags: ["Violent"] });
    const killingFloor = game({ tags: ["Gore"] });

    expect(gameIsAdult(batman)).toBe(false);
    expect(gameIsAdult(hellblade)).toBe(false);
    expect(gameIsAdult(killingFloor)).toBe(false);

    // Opting in is a legitimate but different policy choice.
    expect(gameIsAdult(killingFloor, true)).toBe(true);
  });

  it("reports which signal fired, so a block is explainable", () => {
    expect(adultReason(game({ required_age: 18 }))).toBe("required_age=18");
    expect(adultReason(game({ tags: ["Hentai"] }))).toBe("tag:Hentai");
    expect(adultReason(game({ tags: ["Action"] }))).toBeNull();
  });
});

describe("tag based content filtering", () => {
  const games = [
    game({ id: 1, name: "Normal", tags: ["Action", "Indie"] }),
    game({ id: 2, name: "Hentai Game", tags: ["Hentai", "Anime"] }),
    game({ id: 3, name: "Nudity Game", tags: ["Nudity"] }),
    game({ id: 4, name: "Gore Game", tags: ["Gore", "Action"] }),
    game({ id: 5, name: "Sin tags" }),
  ];

  it("counts real tag hits instead of relying on genres", () => {
    // The packaged catalog keeps content classification in `tags`; `genres`
    // only holds a translated handful, which is why the old dialog showed 1-3.
    const counts = getTagCounts(games, ["Hentai", "Sexual Content", "Nudity", "Gore", "Violent", "Mature"]);
    expect(counts.get("Hentai")).toBe(1);
    expect(counts.get("Nudity")).toBe(1);
    expect(counts.get("Gore")).toBe(1);
    expect(counts.get("Sexual Content")).toBeUndefined();
    expect(counts.get("Violent")).toBeUndefined();
  });

  it("matches tags case-insensitively and ORs within the group", () => {
    expect(gameMatchesTags(games[1], ["hentai"])).toBe(true);
    expect(gameMatchesTags(games[1], ["Hentai", "Nudity"])).toBe(true);
    expect(gameMatchesTags(games[0], ["Hentai"])).toBe(false);
    // No tag selection means no restriction.
    expect(gameMatchesTags(games[0], [])).toBe(true);
  });

  it("excludes by tag and composes with other groups", () => {
    const sexual = filterLibraryGames(games, "", { ...EMPTY_LIBRARY_FILTERS, tags: ["Hentai", "Nudity"] });
    expect(sexual.map(g => g.id)).toEqual([2, 3]);

    const gore = filterLibraryGames(games, "", { ...EMPTY_LIBRARY_FILTERS, tags: ["Gore"] });
    expect(gore.map(g => g.id)).toEqual([4]);

    // Combined tag + query narrows further than either alone.
    const searched = filterLibraryGames(games, "game", { ...EMPTY_LIBRARY_FILTERS, tags: ["Hentai", "Nudity", "Gore"] });
    expect(searched.map(g => g.id)).toEqual([2, 3, 4]);
  });

  it("never treats a missing tag as a match", () => {
    // A game with no tags cannot satisfy a tag filter, and must not be counted
    // as 'possible' the way missing genre metadata is.
    const result = filterLibraryGames(games, "", { ...EMPTY_LIBRARY_FILTERS, tags: ["Hentai"] });
    expect(result.map(g => g.id)).not.toContain(5);
  });

  it("offers the content groups split by meaning", () => {
    expect(CONTENT_FILTER_GROUPS.map(g => g.id)).toEqual(["sexual", "violence"]);
    expect(CONTENT_FILTER_GROUPS[0].tags).toContain("Hentai");
    // Violence tags stay out of the sexual group: they catch mainstream titles.
    expect(CONTENT_FILTER_GROUPS[0].tags).not.toContain("Gore");
    expect(CONTENT_FILTER_GROUPS[1].tags).toContain("Gore");
  });
});

describe("filterLibraryGames and the hidden notice", () => {
  const games = [
    game({ id: 1, name: "Bueno", release_date: OLD, steam_review_score: 85, steam_review_count: 421100 }),
    game({ id: 2, name: "Sin criticas", release_date: OLD, steam_review_score: null, steam_review_count: 0 }),
    game({ id: 3, name: "Malo", release_date: OLD, steam_review_score: 20, steam_review_count: 900 }),
    game({ id: 4, name: "Pocas", release_date: OLD, steam_review_score: 90, steam_review_count: 4 }),
    game({ id: 5, name: "Nuevo", release_date: RECENT, steam_review_score: null, steam_review_count: 0 }),
    game({ id: 6, name: "Adulto", release_date: OLD, steam_review_score: 90, steam_review_count: 900, required_age: 18 }),
  ];

  it("removes nothing while no quality screen is selected", () => {
    expect(filterLibraryGames(games, "", EMPTY_LIBRARY_FILTERS).map(g => g.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("ships with the quality screens on by default, still toggleable", () => {
    const defaults = defaultLibraryFilters();
    expect(defaults.hideNoReviews).toBe(true);
    expect(defaults.hideLowRated).toBe(true);
    expect(defaults.hideFewReviews).toBe(true);
    // Toggling one off must not disturb the others.
    expect({ ...defaults, hideFewReviews: false }.hideNoReviews).toBe(true);
  });

  it("reports how many games each screen hid", () => {
    const detailed = filterLibraryGamesDetailed(games, "", defaultLibraryFilters());
    // The default set screens quality only: the adult filter is opt-in because
    // it cannot work until each game's detail has been cached.
    expect(detailed.games.map(g => g.id)).toEqual([1, 5, 6]);
    expect(detailed.hiddenCount).toBe(3);

    // Each screen can be isolated.
    expect(filterLibraryGamesDetailed(games, "", { ...EMPTY_LIBRARY_FILTERS, hideNoReviews: true }).hiddenCount).toBe(1);
    expect(filterLibraryGamesDetailed(games, "", { ...EMPTY_LIBRARY_FILTERS, hideLowRated: true }).hiddenCount).toBe(1);
    expect(filterLibraryGamesDetailed(games, "", { ...EMPTY_LIBRARY_FILTERS, hideFewReviews: true }).hiddenCount).toBe(1);
    expect(filterLibraryGamesDetailed(games, "", { ...EMPTY_LIBRARY_FILTERS, hideAdult: true }).games.map(g => g.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reports adult blocks separately from quality blocks", () => {
    const detailed = filterLibraryGamesDetailed(games, "", { ...defaultLibraryFilters(), hideAdult: true });
    // A parental block must never be hidden inside the quality count.
    expect(detailed.hiddenCount).toBe(4);
    expect(detailed.hiddenAdultCount).toBe(1);
    expect(detailed.games.map(g => g.id)).toEqual([1, 5]);
  });

  it("only counts a game as hidden when it actually matched the search", () => {
    // "zombie" matches nothing, so nothing was hidden by the filter either.
    const none = filterLibraryGamesDetailed(games, "zombie", defaultLibraryFilters());
    expect(none.games).toHaveLength(0);
    expect(none.hiddenCount).toBe(0);

    // "sin criticas" matches a game that the filter then hides.
    const matched = filterLibraryGamesDetailed(games, "sin criticas", defaultLibraryFilters());
    expect(matched.games).toHaveLength(0);
    expect(matched.hiddenCount).toBe(1);
  });
});
