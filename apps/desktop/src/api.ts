import { AsyncResourceCache } from "./asyncResourceCache";
import { applyBundledCatalogArtwork } from "./bundledArtwork";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { libraryMembership } from "./libraryMembership";
import { queryCatalogCache } from "./catalogCache";
import { getCatalogMode } from "./catalogMode";
import { getAppLocale, LOCALE_CHANGED_EVENT, translate } from "./i18n";
import { narrate } from "./narrationLog";
import { getSteamStoreMetadata, steamInstalledAppIds } from "./native";
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
/** App ids of games with real files in the games folder (empty or partial folders are skipped). */
async function installedDiskAppIds(): Promise<number[]> {
  const local = await digitalProcessManager.localGames();
  const found = (local.games ?? []).filter(game => Number.isSafeInteger(game.id) && game.id > 0);
  if (!found.length) return [];
  const result = await digitalProcessManager.snapshot(found as CatalogGame[]);
  return found.map(game => game.id).filter(id => result.statuses?.[id]?.installed);
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
  // Games already installed in the games folder belong in the library even if this browser never tracked them
  // (restart, cleared storage, files copied by hand): the folder on disk is the source of truth.
  const diskIds = mode === "digital" ? await installedDiskAppIds().catch(() => [] as number[]) : [];
  const downloadEntries = digitalDownloadService.getDownloads();
  const downloadIds = downloadEntries.map(e => e.game.app_id ?? e.game.id);
  const memberIds = libraryMembership.getGames().map(g => g.app_id ?? g.id);
  const activeIds = [...new Set([...installedIds, ...downloadIds, ...memberIds, ...diskIds])];

  let games: CatalogGame[] = [];
  if (activeIds.length > 0) {
    games = await digitalCatalogService.getGamesByAppIds(activeIds);
  }
  // Likes and recently opened games are kept by catalog id: without them Favoritos and
  // "seguir jugando" would be empty, because the full catalog is no longer in memory.
  const ownIds = storedCatalogIds();
  if (ownIds.length) {
    const known = new Set(games.map(game => game.id));
    const missing = ownIds.filter(id => !known.has(id));
    if (missing.length) {
      const extra = await digitalCatalogService.getGamesByCatalogIds(missing).catch(() => [] as CatalogGame[]);
      games = [...games, ...extra];
    }
  }
  currentCatalog = games;
  return {games, user: {id:1, username:"gameaccess", credits:0}, offlineDemo};
}
/** Catalog ids the user liked or recently opened (both saved in this browser). */
function storedCatalogIds(): number[] {
  const ids = new Set<number>();
  try {
    const preferences = JSON.parse(localStorage.getItem("gameaccess:preferences") || "{}") as Record<string, number>;
    for (const [id, value] of Object.entries(preferences)) if (value === 1) ids.add(Number(id));
    const recent = JSON.parse(localStorage.getItem("gameaccess:recent") || "[]") as unknown[];
    for (const id of recent) if (typeof id === "number") ids.add(id);
  } catch { /* nothing stored */ }
  return [...ids].filter(id => Number.isSafeInteger(id) && id > 0);
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
  // Asked from this PC: the central server is not a Steam proxy.
  const raw = await getSteamStoreMetadata(appId);
  if (raw && game) return normalizeSteamStoreMetadata(game, raw);
  throw new Error(`Steam has no store details for AppID ${appId}`);
};
