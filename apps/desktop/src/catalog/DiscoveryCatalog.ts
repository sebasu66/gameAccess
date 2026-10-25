import { getCatalogManifestUrl } from "../settings";
import { recordNewDownloads } from "../newDownloads";
import { queryCatalogCache, syncCatalogCache, type CatalogCacheSyncResult } from "../catalogCache";
import type { CatalogGame } from "../types";
import { narrate } from "../narrationLog";
import { invalidateCatalogMatchingCache } from "./PluginSources";

export interface DiscoveryCatalogSummary {
  updated: boolean;
  revision: string;
  catalog_count: number;
}

/** Digital identities are Steam AppIDs; the shared snapshot also carries legacy DB IDs. */
function steamIdentities(games: CatalogGame[]): CatalogGame[] {
  return games.map(game => ({ ...game, id: game.app_id ?? game.id, catalog_cache_id: game.id }));
}

export function mergeDiscoveryCatalog(base: CatalogGame[], remote: CatalogGame[]): CatalogGame[] {
  const games = new Map(steamIdentities(base).map(game => [game.id, game]));
  for (const incoming of steamIdentities(remote)) {
    const previous = games.get(incoming.id);
    if (!previous) { games.set(incoming.id, incoming); continue; }
    // A smaller/older API response cannot erase discovery coverage or enrichment.
    const present = Object.fromEntries(Object.entries(incoming).filter(([, value]) =>
      value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length)));
    const merged = { ...previous, ...present } as CatalogGame;
    for (const key of ["tags", "genres", "categories"] as const)
      merged[key] = [...new Set([...(previous[key] ?? []), ...(incoming[key] ?? [])])];
    games.set(incoming.id, merged);
  }
  return [...games.values()];
}

/** One log line saying what the catalog check did and how long it took. */
export function catalogCheckLine(synced: CatalogCacheSyncResult): string {
  const download = synced.downloaded === "patch" || synced.downloaded === "package"
    ? `downloaded the ${synced.downloaded} (${((synced.downloaded_bytes ?? 0) / 1048576).toFixed(2)} MB)` : "downloaded nothing else";
  return `Discovery catalog ${synced.updated ? "updated" : "current"}: revision=${synced.revision}, games=${synced.catalog_count}; `
    + `manifest ${synced.manifest_ms ?? "?"} ms, ${download}, check took ${synced.total_ms ?? "?"} ms`
    + (synced.updated ? `; new games matched to saved download sources: ${synced.new_downloads?.length ?? 0} in ${synced.link_ms ?? "?"} ms.` : ".");
}

export async function loadDiscoveryCatalog(requireRemote: boolean, language?: string): Promise<DiscoveryCatalogSummary | null> {
  if (requireRemote) {
    // Only the small manifest GitHub publishes is read; the server is never asked (see catalog_cache.rs sync_blocking).
    const manifest = await Promise.resolve().then(() => getCatalogManifestUrl()).catch(() => "");
    const manifests = manifest ? [manifest] : [];
    for (const manifest of manifests) {
      try {
        const synced = await syncCatalogCache(manifest);
        if (synced) {
          if (synced.updated) {
            invalidateCatalogMatchingCache();
            // Open grids and counters run their query again on the new data (see useCatalogQuery).
            if (typeof window !== "undefined") window.dispatchEvent(new Event("gameaccess:catalog-data-changed"));
          }
          void narrate(catalogCheckLine(synced), {area: "CATALOG"});
          if (synced.new_downloads?.length) recordNewDownloads(synced.new_downloads, "catalog");
          return synced;
        }
      } catch (error) {
        void narrate(`Discovery snapshot refresh failed; preserving local data: ${String(error)}`, {area: "CATALOG", level: "WARN"});
      }
    }
  }

  // Local / offline: query total count from SQLite without loading all 39k games into JS memory.
  const cached = await queryCatalogCache({ limit: 0 }).catch(() => null);
  const count = cached?.total ?? 0;
  if (!requireRemote && count > 0) {
    return { updated: false, revision: "local", catalog_count: count };
  }

  // The full catalog is never downloaded as JSON from the server: only GitHub packages are used.
  if (requireRemote) throw new Error("El catálogo remoto no está disponible.");
  return null;
}
