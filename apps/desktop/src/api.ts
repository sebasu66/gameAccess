import { AsyncResourceCache } from "./asyncResourceCache";
import { activationHeaders, invalidateActivation } from "./activation";
import { applyBundledCatalogArtwork } from "./bundledArtwork";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { libraryMembership } from "./libraryMembership";
import { queryCatalogCache } from "./catalogCache";
import { getCatalogMode } from "./catalogMode";
import { getAppLocale, getSteamStoreLanguage, LOCALE_CHANGED_EVENT, translate } from "./i18n";
import { narrate } from "./narrationLog";
import { getSteamStoreMetadata, steamInstalledAppIds } from "./native";
import { getApiBaseUrl } from "./settings";
import { normalizeSteamStoreMetadata } from "./steamMetadata";
import type { CatalogGame, GameDetails, SteamMetadata, SteamSearchResponse, UserSummary } from "./types";
const gameDetailsResources = new AsyncResourceCache<string, GameDetails>({ttlMs: 24 * 60 * 60 * 1000});
let currentCatalog: CatalogGame[] = [];
if (typeof window !== "undefined") {
  window.addEventListener(LOCALE_CHANGED_EVENT, () => {
    currentCatalog = [];
    digitalCatalogService.clearCache();
  });
}
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
  let offlineDemo = false;
  try {
    await digitalCatalogService.readCatalog();
  } catch {
    offlineDemo = true;
  }
  const mode = getCatalogMode();
  let installedIds: number[] = [];
  if (mode === "local") {
    installedIds = await steamInstalledAppIds().catch(() => []);
  }
  const downloadEntries = digitalDownloadService.getDownloads();
  const downloadIds = downloadEntries.map(e => e.game.app_id ?? e.game.id);
  const memberIds = libraryMembership.getGames().map(g => g.app_id ?? g.id);
  const activeIds = [...new Set([...installedIds, ...downloadIds, ...memberIds])];

  let games: CatalogGame[] = [];
  if (activeIds.length > 0) {
    games = await digitalCatalogService.getGamesByAppIds(activeIds);
  }
  currentCatalog = games;
  return {games, user: {id:1, username:"gameaccess", credits:0}, offlineDemo};
}
export function findLocalGameForDetails(gameId: number, catalog = currentCatalog) {
  return catalog.find(game => game.id === gameId || game.app_id === gameId);
}
export const loadDetails = async (gameId: number, knownGame?: CatalogGame): Promise<GameDetails> =>
  gameDetailsResources.get(detailCacheKey(gameId), () => digitalCatalogService.loadDetails(gameId, knownGame ?? findLocalGameForDetails(gameId)));
export function invalidateDetails(gameId: number) { gameDetailsResources.invalidate(detailCacheKey(gameId)); }
export const searchSteam = async (query: string, limit = 20): Promise<SteamSearchResponse> => {
  const result = await queryCatalogCache({ query, limit }).catch(() => ({ items: [] as CatalogGame[], total: 0 }));
  const matches = result.items;
  return {query, count: result.total, results: matches.map(game => ({
    app_id: game.app_id ?? game.id, name: game.name, image_url: game.header_image, catalog_game: game,
    access_state: "metadata-only", steam_url: game.steam_url ?? undefined,
  }))};
};
export const loadSteamApp = async (appId: number): Promise<SteamMetadata> => {
  let game = findLocalGameForDetails(appId);
  if (!game) {
    const list = await digitalCatalogService.getGamesByAppIds([appId]).catch(() => []);
    game = list[0];
  }
  const raw = await getSteamStoreMetadata(appId);
  if (raw && game) return normalizeSteamStoreMetadata(game, raw);
  return request<SteamMetadata>(`/steam/apps/${appId}?language=${encodeURIComponent(getSteamStoreLanguage())}&country=ar`);
};
