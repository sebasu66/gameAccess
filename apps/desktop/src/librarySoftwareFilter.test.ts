/**
 * The Software filter.
 *
 * The catalog's genre list comes from SteamSpy's tag vocabulary, which mixes
 * software classifications in with game genres. Measured on the published
 * catalog those classifications cover 10 records — `Blender`, `OBS Studio`,
 * `ShareX`, `Godot Engine`, `Driver Booster 3` — titles Steam itself lists under
 * Games.
 *
 * They are not offered as genres, because "Edición fotográfica" is not a way to
 * find a game. Their union is one Software option instead.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_FILTERS,
  filterLibraryGames,
  gameGenres,
  gameIsSoftware,
  getLibrarySearchFacets,
  SOFTWARE_GENRES,
  type LibrarySearchFilters,
} from "./librarySearch";
import type { CatalogGame } from "./types";

function game(id: number, name: string, genres: string[]): CatalogGame {
  return {
    id, app_id: id, name, slug: `game-${id}`, credit_cost_per_hour: 0,
    copies_total: 1, copies_available: 1, genres, categories: [],
  } as CatalogGame;
}

// Real genre combinations from the catalog.
const blender = game(1, "Blender", ["Animación y modelado", "Diseño e ilustración", "Producción de vídeo"]);
const obs = game(2, "OBS Studio", ["Producción de vídeo", "Utilidades"]);
const godot = game(3, "Godot Engine", ["Desarrollo de juegos"]);
const stardew = game(4, "Stardew Valley", ["RPG", "Simulation", "Indie"]);
const portal = game(5, "Portal 2", ["Acción", "Aventura"]);
const catalog = [blender, obs, godot, stardew, portal];

const filters = (extra: Partial<LibrarySearchFilters>): LibrarySearchFilters => ({ ...DEFAULT_LIBRARY_FILTERS, ...extra });
const ids = (result: CatalogGame[]) => result.map(item => item.id);

describe("software is recognised from its genre vocabulary", () => {
  it("flags the software records and only those", () => {
    expect([blender, obs, godot].every(gameIsSoftware)).toBe(true);
    expect([stardew, portal].some(gameIsSoftware)).toBe(false);
  });

  it("keeps software classifications out of the game genres", () => {
    expect(gameGenres(blender)).toEqual([]);
    expect(gameGenres(stardew)).toEqual(["rpg", "simulation", "indie"]);
  });

  it("does not offer a software classification as a genre in the facets", () => {
    const facets = getLibrarySearchFacets(catalog);
    // The point of the whole change: these must not appear as genres to pick.
    for (const genre of SOFTWARE_GENRES) expect(facets.genres).not.toContain(genre);
    expect(facets.genres).toContain("rpg");
    expect(facets.genres).toContain("adventure");
  });
});

describe("the Software filter", () => {
  it("selects the software records", () => {
    expect(ids(filterLibraryGames(catalog, "", filters({ software: true })))).toEqual([1, 2, 3]);
  });

  it("excludes them when the filter is off, leaving only games", () => {
    expect(ids(filterLibraryGames(catalog, "", filters({ software: false })))).toEqual([4, 5]);
  });

  it("leaves only games when the choice is untouched, which is the default", () => {
    // The default is a games search: programs must never appear in it without the
    // user asking for them.
    expect(ids(filterLibraryGames(catalog, ""))).toEqual([4, 5]);
    expect(ids(filterLibraryGames(catalog, "", DEFAULT_LIBRARY_FILTERS))).toEqual([4, 5]);
  });

  it("is an exclusive choice, so a search is either games or programs", () => {
    const programs = ids(filterLibraryGames(catalog, "", filters({ software: true })));
    const games = ids(filterLibraryGames(catalog, "", filters({ software: false })));
    // No record is in both halves, and together they cover the catalog: the two
    // are a partition, not a blend.
    expect(programs.filter(id => games.includes(id))).toEqual([]);
    expect([...programs, ...games].sort((a, b) => a - b)).toEqual(catalog.map(item => item.id).sort((a, b) => a - b));
  });

  it("combines with a genre only where that genre exists", () => {
    // "Software + RPG" is empty: a software entry has no game genres.
    expect(filterLibraryGames(catalog, "", filters({ software: true, genres: ["RPG"] }))).toEqual([]);
    // And "games + Aventura" reaches Portal 2 alone.
    expect(ids(filterLibraryGames(catalog, "", filters({ software: false, genres: ["Aventura"] })))).toEqual([5]);
  });
});
