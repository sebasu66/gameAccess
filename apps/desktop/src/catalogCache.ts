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

export async function readCatalogCache(): Promise<CatalogGame[]> {
  if (!native()) return [];
  return invoke<CatalogGame[]>("catalog_cache_read");
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
