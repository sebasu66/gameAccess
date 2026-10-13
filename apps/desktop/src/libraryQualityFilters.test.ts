import { describe, expect, it } from "vitest";
import {
  CONTENT_FILTER_GROUPS,
  DEFAULT_LIBRARY_FILTERS,
  adultReason,
  defaultLibraryFilters,
  filterLibraryGames,
  filterLibraryGamesDetailed,
  gameIsAdult,
  gameHasViolenceDescriptor,
  gameMatchesTags,
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
    // 22.5% of the catalog has no usable date. With no year bound set, none of it
    // may be hidden for lacking a date.
    const filters = { ...DEFAULT_LIBRARY_FILTERS };
    expect(filterLibraryGames([game({ id: 1, release_date: "Por confirmarse" })], "", filters)).toHaveLength(1);
    expect(filterLibraryGames([game({ id: 1, release_date: null })], "", filters)).toHaveLength(1);
  });
});

describe("the score slider is an explicit bound, not an age heuristic", () => {
  it("keeps a game at or above the bar and drops one below it, at any age", () => {
    // The old screens gated everything on release age; an explicit minimum does
    // not. A recent game below the bar is below the bar.
    const bound = { ...DEFAULT_LIBRARY_FILTERS, minReviewScore: 70 };
    const games = [
      game({ id: 1, name: "Above", steam_review_score: 70 }),
      game({ id: 2, name: "Below", steam_review_score: 69.9 }),
      game({ id: 3, name: "Brand new below", steam_review_score: 20, release_date: RECENT }),
      game({ id: 4, name: "Scored high", steam_review_score: 95 }),
    ];
    expect(filterLibraryGames(games, "", bound).map(g => g.id)).toEqual([1, 4]);
  });

  it("drops a game with no score, because it cannot be measured against the bar", () => {
    const bound = { ...DEFAULT_LIBRARY_FILTERS, minReviewScore: 50 };
    // An unknown score is not "good enough". Returning it would be the silent
    // false positive this whole filter rework removes.
    expect(filterLibraryGames([game({ id: 1, steam_review_score: null })], "", bound)).toHaveLength(0);
    expect(filterLibraryGames([game({ id: 1, steam_review_score: undefined })], "", bound)).toHaveLength(0);
  });

  it("is off when the bound is undefined, whatever the scores are", () => {
    const games = [
      game({ id: 1, steam_review_score: 10 }),
      game({ id: 2, steam_review_score: null }),
    ];
    expect(filterLibraryGames(games, "", DEFAULT_LIBRARY_FILTERS)).toHaveLength(2);
  });
});

describe("the release-year sliders are bounds on a readable date", () => {
  it("keeps only games inside the range", () => {
    const range = { ...DEFAULT_LIBRARY_FILTERS, releaseYearFrom: 2020, releaseYearTo: 2022 };
    const games = [
      game({ id: 1, release_date: "2019-12-31" }),
      game({ id: 2, release_date: "2020-01-01" }),
      game({ id: 3, release_date: "2022-12-31" }),
      game({ id: 4, release_date: "2023-01-01" }),
    ];
    expect(filterLibraryGames(games, "", range).map(g => g.id)).toEqual([2, 3]);
  });

  it("drops a game whose date cannot be read, because it cannot be placed in the range", () => {
    const range = { ...DEFAULT_LIBRARY_FILTERS, releaseYearFrom: 2000 };
    // 22.5% of the catalog has no usable date. Saying "unknown" is not "recent".
    expect(filterLibraryGames([game({ id: 1, release_date: "Por confirmarse" })], "", range)).toHaveLength(0);
    expect(filterLibraryGames([game({ id: 1, release_date: null })], "", range)).toHaveLength(0);
    // But an unreadable date is never treated as OLD when the range is off.
    expect(filterLibraryGames([game({ id: 1, release_date: "Por confirmarse" })], "", DEFAULT_LIBRARY_FILTERS)).toHaveLength(1);
  });
});

describe("adult screen uses Valve's official descriptors", () => {
  it("blocks adult-only content from the descriptor ids the server resolves", () => {
    // 3 and 4 are the ids present on every explicit title tested and absent
    // from every mainstream one.
    expect(gameIsAdult(game({ content_descriptorids: [1, 3, 4, 5] }))).toBe(true);
    expect(gameIsAdult(game({ content_descriptorids: [3, 5] }))).toBe(true);
    expect(gameIsAdult(game({ adult_only: true }))).toBe(true);
    // No signal at all: unknown is not adult.
    expect(gameIsAdult(game({}))).toBe(false);
  });

  it("does not treat violence or mature descriptors as adult content", () => {
    // Mortal Kombat 11 is officially [2, 5]: frequent violence plus general
    // mature content. Valve lists no sexual descriptor for it.
    expect(gameIsAdult(game({ content_descriptorids: [2, 5] }))).toBe(false);
    expect(gameIsAdult(game({ content_descriptorids: [5] }))).toBe(false);
    // Descriptor 1 (some nudity or sexual content) is a stricter, opt-in policy.
    expect(gameIsAdult(game({ content_descriptorids: [1, 2, 5] }))).toBe(false);
    expect(gameIsAdult(game({ content_descriptorids: [1, 2, 5] }), true)).toBe(true);
  });

  it("ignores community tags, which produced the false positives", () => {
    // Mortal Kombat 11 carries the user tag "Sexual Content" but no sexual
    // descriptor from Valve. Tags must never decide an adult block.
    expect(gameIsAdult(game({ tags: ["Sexual Content"], content_descriptorids: [2, 5] }))).toBe(false);
    expect(gameIsAdult(game({ tags: ["Hentai"] }))).toBe(false);
    expect(gameIsAdult(game({ tags: ["Nudity"] }))).toBe(false);
  });

  it("reports violence as its own axis, not as adult content", () => {
    // Descriptor 2 is screened by its own flag so turning the adult block off
    // cannot silently turn a violence screen off with it.
    const mk11 = game({ content_descriptorids: [2, 5] });
    expect(gameIsAdult(mk11)).toBe(false);
    expect(gameHasViolenceDescriptor(mk11)).toBe(true);
    expect(gameHasViolenceDescriptor(game({ content_descriptorids: [1, 3, 4, 5] }))).toBe(false);
    const filters = { ...DEFAULT_LIBRARY_FILTERS, hideViolenceDescriptor: true };
    expect(filterLibraryGames([mk11], "", filters)).toHaveLength(0);
    // Without that flag the game stays visible even though it is violent.
    expect(filterLibraryGames([mk11], "", DEFAULT_LIBRARY_FILTERS)).toHaveLength(1);
  });

  it("falls back to Steam's own age gate when no descriptor is cached", () => {
    expect(gameIsAdult(game({ required_age: 18 }))).toBe(true);
    expect(gameIsAdult(game({ required_age: "18" }))).toBe(true);
    expect(gameIsAdult(game({ required_age: 0 }))).toBe(false);
  });

  it("reports which signal fired, so a block is explainable", () => {
    expect(adultReason(game({ content_descriptorids: [1, 3, 4, 5] }))).toBe("descriptor:3");
    expect(adultReason(game({ content_descriptorids: [2, 5] }))).toBeNull();
    expect(adultReason(game({ adult_only: true }))).toBe("descriptor:adult-only");
    expect(adultReason(game({ required_age: 18 }))).toBe("required_age=18");
    expect(adultReason(game({ tags: ["Hentai"] }))).toBeNull();
  });
});

describe("content filtering uses Valve descriptors, not community tags", () => {
  const games = [
    game({ id: 1, name: "Normal", tags: ["Action", "Indie"], content_descriptorids: [] }),
    // Tagged sexual but Valve lists no such descriptor: the exact false positive
    // that put Blender and 5D Chess in a sexual-content result.
    game({ id: 2, name: "Tagged only", tags: ["Hentai", "Anime"], content_descriptorids: [] }),
    game({ id: 3, name: "Descriptor nudity", tags: [], content_descriptorids: [1] }),
    game({ id: 4, name: "Descriptor adult", tags: [], content_descriptorids: [3, 4] }),
    // Violence is descriptor 2, which is a parental policy and not this group.
    game({ id: 5, name: "Descriptor violence", tags: ["Gore"], content_descriptorids: [2] }),
  ];
  const sexual = [1, 3, 4];

  it("selects only games whose descriptors match", () => {
    const result = filterLibraryGames(games, "", { ...DEFAULT_LIBRARY_FILTERS, contentDescriptorIds: sexual });
    expect(result.map(g => g.id)).toEqual([3, 4]);
  });

  it("ignores a community tag, which is the whole point", () => {
    const result = filterLibraryGames(games, "", { ...DEFAULT_LIBRARY_FILTERS, contentDescriptorIds: sexual });
    // Game 2 is tagged Hentai and still must not appear.
    expect(result.map(g => g.id)).not.toContain(2);
    expect(gameMatchesTags(games[1], ["Hentai"])).toBe(true);
  });

  it("composes with a text query", () => {
    const named = [...games, game({ id: 6, name: "Tagged only two", tags: ["Nudity"], content_descriptorids: [1] })];
    const result = filterLibraryGames(named, "tagged", { ...DEFAULT_LIBRARY_FILTERS, contentDescriptorIds: sexual });
    expect(result.map(g => g.id)).toEqual([6]);
  });

  it("never treats a missing descriptor as a match", () => {
    const result = filterLibraryGames(games, "", { ...DEFAULT_LIBRARY_FILTERS, contentDescriptorIds: sexual });
    expect(result.map(g => g.id)).not.toContain(1);
    expect(result.map(g => g.id)).not.toContain(2);
  });

  it("keeps only sexual content in the discovery groups", () => {
    // Discovery is a positive search on descriptors. Violence moved to parental
    // control, where the same topic is a screen, so it does not carry two
    // meanings in one panel.
    expect(CONTENT_FILTER_GROUPS.map(g => g.id)).toEqual(["sexual"]);
    expect(CONTENT_FILTER_GROUPS[0].descriptorIds).toContain(1);
    expect(CONTENT_FILTER_GROUPS[0].descriptorIds).not.toContain(2);
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

  it("removes nothing while no screen or bound is selected", () => {
    expect(filterLibraryGames(games, "", DEFAULT_LIBRARY_FILTERS).map(g => g.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("starts with no bound set, so an untouched panel filters nothing", () => {
    // The score and year controls are explicit bounds. Until the user sets one,
    // nothing is hidden: the old set of always-on screens is gone, and a panel
    // that silently drops half the catalog was the problem.
    const defaults = defaultLibraryFilters();
    expect(defaults.minReviewScore).toBeUndefined();
    expect(defaults.releaseYearFrom).toBeUndefined();
    expect(defaults.releaseYearTo).toBeUndefined();
    expect(defaults.hideAdult).toBeUndefined();
  });

  it("reports how many games a bound hid", () => {
    // An untouched panel hides nothing: every record is still there.
    const idle = filterLibraryGamesDetailed(games, "", defaultLibraryFilters());
    expect(idle.games.map(g => g.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(idle.hiddenCount).toBe(0);

    // A minimum score of 85 keeps only the well-reviewed ones.
    const scored = filterLibraryGamesDetailed(games, "", { ...DEFAULT_LIBRARY_FILTERS, minReviewScore: 85 });
    expect(scored.games.map(g => g.id)).toEqual([1, 4, 6]);
    expect(scored.hiddenCount).toBe(3);

    // And the adult screen is its own axis.
    expect(filterLibraryGamesDetailed(games, "", { ...DEFAULT_LIBRARY_FILTERS, hideAdult: true }).games.map(g => g.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reports adult blocks separately from the other screens", () => {
    const detailed = filterLibraryGamesDetailed(games, "", { ...DEFAULT_LIBRARY_FILTERS, hideAdult: true });
    // A parental block must never be hidden inside a quality count.
    expect(detailed.hiddenAdultCount).toBe(1);
    expect(detailed.hiddenCount).toBe(1);
    expect(detailed.games.map(g => g.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("only counts a game as hidden when it actually matched the search", () => {
    // "zombie" matches nothing, so nothing was hidden by a filter either.
    const none = filterLibraryGamesDetailed(games, "zombie", defaultLibraryFilters());
    expect(none.games).toHaveLength(0);
    expect(none.hiddenCount).toBe(0);

    // "sin criticas" matches the scoreless game, which the minimum score hides.
    const bound = { ...DEFAULT_LIBRARY_FILTERS, minReviewScore: 50 };
    const matched = filterLibraryGamesDetailed(games, "sin criticas", bound);
    expect(matched.games).toHaveLength(0);
    expect(matched.hiddenCount).toBe(1);
  });
});
