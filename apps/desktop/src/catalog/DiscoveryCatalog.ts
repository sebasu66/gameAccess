import { getApiBaseUrl, getCatalogManifestUrl } from "../settings";
import { readCatalogCache, syncCatalogCache } from "../catalogCache";
import type { CatalogGame } from "../types";
import { narrate } from "../narrationLog";

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

export async function loadDiscoveryCatalog(requireRemote: boolean): Promise<CatalogGame[] | null> {
  const local = await readCatalogCache().catch(() => []);
  // First paint uses the installer/cache; network work belongs to the updater.
  if (!requireRemote && local.length) return steamIdentities(local);
  if (requireRemote) {
    const api = await Promise.resolve().then(() => getApiBaseUrl()).catch(() => "");
    const fallback = await Promise.resolve().then(() => getCatalogManifestUrl()).catch(() => "");
    const manifests = [api ? `${api}/library/catalog/manifest` : "", fallback].filter(Boolean);
    for (const manifest of manifests) {
      try {
        const synced = await syncCatalogCache(manifest);
        if (synced) {
          const refreshed = await readCatalogCache();
          if (!refreshed.length) throw new Error("El catálogo actualizado está vacío.");
          void narrate(`Discovery catalog ${synced.updated ? "updated" : "current"}: revision=${synced.revision}, games=${synced.catalog_count}.`, {area: "CATALOG"});
          return steamIdentities(refreshed);
        }
      } catch (error) {
        void narrate(`Discovery snapshot refresh failed; preserving local data: ${String(error)}`, {area: "CATALOG", level: "WARN"});
      }
    }
  }
  if (typeof window === "undefined" || typeof fetch === "undefined") return null;
  const api = await getApiBaseUrl();
  if (!api) {
    if (requireRemote) throw new Error("El catálogo remoto no está disponible.");
    return null;
  }
  try {
    const response = await fetch(`${api}/library/catalog`, {cache: "no-store", signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error(`No pudimos actualizar el catálogo (${response.status}).`);
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) throw new Error("El catálogo remoto no está disponible.");
    return mergeDiscoveryCatalog(local, raw);
  } catch (error) {
    if (requireRemote) throw error;
    return null;
  }
}
