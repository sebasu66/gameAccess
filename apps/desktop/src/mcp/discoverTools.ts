/**
 * Discover: the catalog and the player's taste, for "suggest me new games" and "something co-op like X". The search
 * builds its query exactly as the catalog screen does (catalogParamsFromFilters) and the parental policy applies to it
 * the same way, so an AI never finds what the controls hide.
 */
import { loadAiProfile, describeProfile } from "../aiProfile";
import { catalogParamsFromFilters, loadCatalogGenreNames } from "../catalogFilterParams";
import { queryCatalogCache, type CatalogQueryParams } from "../catalogCache";
import { defaultLibraryFilters, LIBRARY_FEATURE_OPTIONS, type LibraryFeatureKey, type LibrarySearchFilters } from "../librarySearch";
import { applyParentalPolicy } from "../parentalControl";
import { libraryScanState, scanLibrary } from "../libraryScan";
import { buildTasteProfile, loadTasteNames, type Ratings } from "../tasteProfile";
import type { CatalogGame } from "../types";
import { bool, gb, list, num, str, ToolError, type McpTool } from "./tools";

const SORTS = { popularity: "steam-popularity", rating: "steam-review-score", newest: "release-date", name: "name" } as const;
type SortName = keyof typeof SORTS;

/** A game as the AI needs it: enough to choose and to tell the player why, without the whole record. */
export function gameSummary(game: CatalogGame) {
  return {
    app_id: game.app_id,
    name: game.name,
    release_date: game.release_date ?? null,
    genres: game.genres ?? [],
    tags: (game.tags ?? []).slice(0, 8),
    review_score: game.steam_review_score ?? null,
    review_count: game.steam_review_count ?? null,
    downloadable: Boolean(game.has_downloads ?? (game.availableSourceCount ?? game.source_count ?? 0) > 0),
    short_description: game.short_description ?? null,
  };
}

/** The catalog record of one game, by its Steam app id, or a refusal the AI can act on. */
export async function catalogGame(appId: number): Promise<CatalogGame> {
  const found = await queryCatalogCache({ app_ids: [appId], limit: 1 });
  const game = found.items[0];
  if (!game) throw new ToolError(`No game with app_id ${appId} in the catalog. Use catalog_search to find its app_id.`);
  return game;
}

const readRatings = (): Ratings => { try { return JSON.parse(localStorage.getItem("gameaccess:preferences") || "{}") as Ratings; } catch { return {}; } };

const featureKeys = () => LIBRARY_FEATURE_OPTIONS.map(option => option.key);

async function search(args: Record<string, unknown>) {
  const sort = (str(args, "sort") ?? "popularity") as SortName;
  if (!(sort in SORTS)) throw new ToolError(`"sort" must be one of: ${Object.keys(SORTS).join(", ")}`);
  const features = list(args, "features");
  const unknown = features.filter(key => !featureKeys().includes(key as LibraryFeatureKey));
  if (unknown.length) throw new ToolError(`Unknown features: ${unknown.join(", ")}. Use catalog_filters for the list.`);
  const filters: LibrarySearchFilters = applyParentalPolicy({
    ...defaultLibraryFilters(),
    genres: list(args, "genres"),
    excludeGenres: list(args, "exclude_genres"),
    features: features as LibraryFeatureKey[],
    excludeFeatures: list(args, "exclude_features") as LibraryFeatureKey[],
    minReviewScore: num(args, "min_review_score", { min: 0, max: 100 }),
  });
  const names = await loadCatalogGenreNames();
  const limit = num(args, "limit", { min: 1, max: 50 }) ?? 20;
  const params: CatalogQueryParams = {
    ...catalogParamsFromFilters(str(args, "query") ?? "", filters, names),
    sort_by: SORTS[sort],
    sort_direction: sort === "name" ? "asc" : "desc",
    limit,
    offset: num(args, "offset", { min: 0 }) ?? 0,
  };
  if (bool(args, "released_only")) params.released_only = true;
  const yearFrom = num(args, "release_year_from"); if (yearFrom) params.release_year_from = yearFrom;
  const yearTo = num(args, "release_year_to"); if (yearTo) params.release_year_to = yearTo;
  if (bool(args, "downloadable_only")) params.has_downloads = true;
  const owned = new Set(libraryScanState().games.filter(game => game.installed).map(game => game.app_id));
  const fresh = bool(args, "not_installed") ?? false;
  // Without the installed ones: ask for enough more to still fill the page (the query cannot leave them out itself).
  const result = await queryCatalogCache(fresh ? { ...params, limit: Math.min(200, limit + owned.size) } : params);
  const games = result.items.filter(game => !fresh || !owned.has(game.app_id)).slice(0, limit);
  return {
    total: result.total,
    shown: games.length,
    games: games.map(game => ({ ...gameSummary(game), installed: owned.has(game.app_id) })),
  };
}

export const discoverTools: McpTool[] = [
  {
    name: "catalog_search",
    title: "Search the catalog",
    description: "Search Game Access's game catalog like the catalog screen: text, genres, gameplay features (co-op, multiplayer...), minimum review score, release years. Parental controls apply. Each game says whether it is already installed and whether it can be downloaded. Use catalog_filters first to learn valid genre and feature names.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words in the game's name." },
        genres: { type: "array", items: { type: "string" }, description: "Genres the game must have (names from catalog_filters)." },
        exclude_genres: { type: "array", items: { type: "string" } },
        features: { type: "array", items: { type: "string" }, description: "Gameplay features it must have, e.g. coop, online_multiplayer (keys from catalog_filters)." },
        exclude_features: { type: "array", items: { type: "string" } },
        min_review_score: { type: "number", description: "Minimum Steam review percentage, 0-100." },
        release_year_from: { type: "number" },
        release_year_to: { type: "number" },
        released_only: { type: "boolean", description: "Only games already out." },
        downloadable_only: { type: "boolean", description: "Only games a source can download now." },
        not_installed: { type: "boolean", description: "Leave out the games the player already has: for suggesting new ones." },
        sort: { type: "string", enum: Object.keys(SORTS) },
        limit: { type: "number", description: "1-50, default 20." },
        offset: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: search,
  },
  {
    name: "catalog_filters",
    title: "Catalog genres and features",
    description: "The genre names and gameplay feature keys catalog_search accepts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async () => ({
      genres: await loadCatalogGenreNames(),
      features: LIBRARY_FEATURE_OPTIONS.map(option => ({ key: option.key, label: option.label })),
      sorts: Object.keys(SORTS),
    }),
  },
  {
    name: "game_details",
    title: "A game's details",
    description: "Everything Game Access knows about one game by its Steam app_id: description, genres, tags, players, reviews, and, if it is in the library, its size, plays and state.",
    inputSchema: { type: "object", properties: { app_id: { type: "number" } }, required: ["app_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async args => {
      const appId = num(args, "app_id");
      if (appId == null) throw new ToolError('"app_id" is needed');
      const game = await catalogGame(appId);
      const entry = libraryScanState().games.find(row => row.app_id === appId);
      return {
        ...gameSummary(game),
        categories: game.categories ?? [],
        developers: game.developers ?? [],
        publishers: game.publishers ?? [],
        players: { min: game.min_players ?? null, max: game.max_players ?? null, local_max: game.local_players_max ?? null, online_max: game.online_players_max ?? null },
        metacritic: game.metacritic_score ?? null,
        required_age: game.required_age ?? null,
        steam_url: game.steam_url ?? null,
        sources: game.download_source_names ?? game.source_names ?? [],
        library: entry ? {
          installed: entry.installed, state: entry.state, size_gb: gb(entry.size_bytes), plays: entry.plays ?? 0,
          last_played: entry.last_played ?? null, frozen: entry.frozen ?? null,
        } : null,
      };
    },
  },
  {
    name: "player_taste",
    title: "What the player likes",
    description: "The player's taste: the profile they wrote for AI suggestions (liked and disliked genres, single or multiplayer, their own words), the games they rated with thumbs up or down, the traits Game Access learned from those ratings, and their most played installed games. Use it before suggesting games.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async () => {
      if (!libraryScanState().summary) await scanLibrary();
      const ratings = readRatings();
      const names = loadTasteNames();
      const rated = (value: 1 | -1) => Object.entries(ratings).filter(([, rating]) => rating === value).map(([id]) => names[Number(id)] ?? `#${id}`);
      const taste = buildTasteProfile(ratings);
      const played = libraryScanState().games.filter(game => game.installed && (game.plays ?? 0) > 0)
        .sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0)).slice(0, 15)
        .map(game => ({ app_id: game.app_id, name: game.name, plays: game.plays ?? 0, last_played: game.last_played ?? null }));
      return {
        profile: describeProfile(loadAiProfile()),
        liked_games: rated(1),
        disliked_games: rated(-1),
        learned_traits: { certainty: Math.round(taste.certainty * 100) / 100, liked: taste.traits.filter(t => t.weight > 0).map(t => t.label), disliked: taste.traits.filter(t => t.weight < 0).map(t => t.label) },
        most_played: played,
      };
    },
  },
];
