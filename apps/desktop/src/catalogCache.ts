import { invoke } from "@tauri-apps/api/core";
import type { CatalogGame, GameDetails } from "./types";

export interface CatalogCacheSyncResult {
  updated: boolean;
  revision: string;
  catalog_count: number;
}

const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function syncCatalogCache(manifestUrl: string): Promise<CatalogCacheSyncResult | null> {
  if (!native() || !manifestUrl) return null;
  return invoke<CatalogCacheSyncResult>("catalog_cache_sync", { manifestUrl });
}

/** Installs (or updates from) the catalog database that ships with the app; reports gameaccess:catalog-progress. */
export async function prepareCatalogCache(): Promise<{ installed: boolean; revision: string; catalog_count: number } | null> {
  if (!native()) return null;
  return invoke("catalog_prepare");
}

export async function readCatalogCache(language?: string): Promise<CatalogGame[]> {
  if (!native()) return [];
  return invoke<CatalogGame[]>("catalog_cache_read", { language });
}

/** Light version of readCatalogCache: only id, app_id and name of each game. */
export async function readCatalogNames(): Promise<CatalogGame[]> {
  if (!native()) return [];
  return invoke<CatalogGame[]>("catalog_cache_read_names");
}

export async function upsertCatalogCacheGame(game: CatalogGame): Promise<void> {
  if (!native()) return;
  await invoke("catalog_cache_upsert_game", { game });
}

export async function readCatalogCachedDetail(
  gameId: number,
  language: string,
  country: string,
): Promise<GameDetails | null> {
  if (!native()) return null;
  return invoke<GameDetails | null>("catalog_cache_read_detail", {
    gameId,
    language,
    country,
  });
}

export async function storeCatalogCachedDetail(
  gameId: number,
  language: string,
  country: string,
  detail: GameDetails,
): Promise<void> {
  if (!native()) return;
  await invoke("catalog_cache_store_detail", {
    gameId,
    language,
    country,
    detail,
  });
}

export interface CatalogQueryParams {
  query?: string;
  genres?: string[];
  features?: string[];
  sources?: string[];
  has_downloads?: boolean;
  language?: string;
  sort_by?: string;
  sort_direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
  min_rating?: number;
  max_age_days?: number;
  include_recent_unrated?: boolean;
  /** Strict floor on the number of reviews; games with fewer (or none on record) are hidden. */
  min_review_count?: number;
  app_ids?: number[];
  exclude_genres?: string[];
  exclude_features?: string[];
  exclude_sources?: string[];
  content_descriptor_ids?: number[];
  exclude_content_descriptor_ids?: number[];
  hide_adult?: boolean;
  adult_includes_nudity?: boolean;
  release_year_from?: number;
  release_year_to?: number;
  /** Catalog ids (likes and recent games are stored by catalog id, not Steam app id). */
  game_ids?: number[];
}

export interface CatalogQueryResult {
  items: CatalogGame[];
  total: number;
}

export interface CatalogFacetsResult {
  genres: string[];
  sources?: string[];
}

export async function queryCatalogCache(params: CatalogQueryParams): Promise<CatalogQueryResult> {
  if (!native()) return { items: [], total: 0 };
  return invoke<CatalogQueryResult>("catalog_cache_query", { params });
}

export async function getCatalogFacets(): Promise<CatalogFacetsResult> {
  if (!native()) return { genres: [], sources: [] };
  return invoke<CatalogFacetsResult>("catalog_cache_get_facets");
}

export interface SourceIndexEntry {
  key?: string;
  title: string;
  source: string;
  multiplayer?: boolean;
}

export interface CatalogSourcesApplyParams {
  pluginId: string;
  revision: string;
  full: boolean;
  added: SourceIndexEntry[];
  removed?: string[];
}

export interface CatalogSourcesApplyResult {
  plugin_id: string;
  revision: string;
  sources_total: number;
  matched_links: number;
}

export async function applyCatalogSources(params: CatalogSourcesApplyParams): Promise<CatalogSourcesApplyResult | null> {
  if (!native()) return null;
  return invoke<CatalogSourcesApplyResult>("catalog_sources_apply", {
    pluginId: params.pluginId,
    revision: String(params.revision),
    full: params.full,
    added: params.added,
    removed: params.removed ?? [],
  });
}

export async function removePluginCatalogSources(pluginId: string): Promise<void> {
  if (!native()) return;
  await invoke("catalog_sources_remove_plugin", { pluginId });
}

