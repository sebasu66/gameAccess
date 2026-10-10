import { AsyncResourceCache } from "./asyncResourceCache";
import { activationHeaders, invalidateActivation } from "./activation";
import { applyBundledCatalogArtwork } from "./bundledArtwork";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { getCatalogMode } from "./catalogMode";
import { getAppLocale, getSteamStoreLanguage, translate } from "./i18n";
import { narrate } from "./narrationLog";
import { getSteamStoreMetadata, steamInstalledAppIds } from "./native";
import { getApiBaseUrl } from "./settings";
import { normalizeSteamStoreMetadata } from "./steamMetadata";
import type { CatalogGame, GameDetails, SteamMetadata, SteamSearchResponse, UserSummary } from "./types";
const gameDetailsResources = new AsyncResourceCache<string, GameDetails>({ttlMs: 24 * 60 * 60 * 1000});
let currentCatalog: CatalogGame[] = [];
function detailCacheKey(gameId: number) { return `${getAppLocale()}|${gameId}`; }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const api = await getApiBaseUrl();
  if (!api) {
    await narrate(`Backend request ${init?.method ?? "GET"} ${path} was skipped because no GameAccess server URL is configured.`, { area: "BACKEND", level: "WARN" });
    throw new Error("El servidor de GameAccess no está configurado.");
  }

  const method = init?.method ?? "GET";
  await narrate(`Sending ${method} ${path} to the GameAccess backend at ${api}.`, { area: "BACKEND" });
  const response = await fetch(`${api}${path}`, {
    ...init,
    cache: method === "GET" ? "no-store" : init?.cache,
    headers: { "Content-Type": "application/json", ...activationHeaders(), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    if (response.status === 401) invalidateActivation();
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (body?.detail) detail = `${response.status} ${String(body.detail)}`;
    } catch {
      // Keep the HTTP status when the backend did not return JSON.
    }
    await narrate(`Backend request ${method} ${path} failed with HTTP ${response.status}: ${detail}.`, { area: "BACKEND", level: "ERROR" });
    throw new Error(detail);
  }
  await narrate(`Backend request ${method} ${path} succeeded with HTTP ${response.status}.`, { area: "BACKEND" });
  return response.json() as Promise<T>;
}


export async function loadHome(): Promise<{games: CatalogGame[]; user: UserSummary; offlineDemo: boolean}> {
  const catalog = await digitalCatalogService.loadCatalog();
  const mode = getCatalogMode();
  if (mode === "local") {
    const installed = new Set(await steamInstalledAppIds());
    currentCatalog = catalog.filter(game => game.app_id && installed.has(game.app_id));
  } else currentCatalog = catalog;
  return {games: await applyBundledCatalogArtwork(currentCatalog), user: {id:1, username:"gameaccess", credits:0}, offlineDemo:false};
}
export function findLocalGameForDetails(gameId: number, catalog = currentCatalog) {
  return catalog.find(game => game.id === gameId || game.app_id === gameId);
}
export const loadDetails = async (gameId: number): Promise<GameDetails> =>
  gameDetailsResources.get(detailCacheKey(gameId), () => digitalCatalogService.loadDetails(gameId));
export function invalidateDetails(gameId: number) { gameDetailsResources.invalidate(detailCacheKey(gameId)); }
export const searchSteam = async (query: string, limit = 20): Promise<SteamSearchResponse> => {
  const games = currentCatalog.length ? currentCatalog : await digitalCatalogService.loadCatalog();
  const matches = games.filter(game => game.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return {query, count: matches.length, results: matches.slice(0,limit).map(game => ({
    app_id: game.app_id ?? game.id, name: game.name, image_url: game.header_image, catalog_game: game,
    access_state: "metadata-only", steam_url: game.steam_url ?? undefined,
  }))};
};
export const loadSteamApp = async (appId: number): Promise<SteamMetadata> => {
  const game = findLocalGameForDetails(appId);
  const raw = await getSteamStoreMetadata(appId);
  if (raw && game) return normalizeSteamStoreMetadata(game, raw);
  return request<SteamMetadata>(`/steam/apps/${appId}?language=${encodeURIComponent(getSteamStoreLanguage())}&country=ar`);
};
