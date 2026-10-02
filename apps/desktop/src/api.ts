import { AsyncResourceCache } from "./asyncResourceCache";
import { activationHeaders, invalidateActivation } from "./activation";
import { applyBundledCatalogArtwork, applyBundledDetails } from "./bundledArtwork";
import { GameAccessCatalog } from "./catalog/GameAccessCatalog";
import { PersonalCatalog } from "./catalog/PersonalCatalog";
import { getCatalogMode } from "./catalogMode";
import { getAppLocale, getSteamStoreLanguage, translate } from "./i18n";
import { narrate, narrateBatch } from "./narrationLog";
import { getLocalSteamPool, getSteamStoreMetadata, switchSteamAccount } from "./native";
import { loginProviderSteam } from "./providerLogin";
import { getApiBaseUrl, getCatalogManifestUrl } from "./settings";
import {
  readCatalogCache,
  readCatalogCachedDetail,
  storeCatalogCachedDetail,
  syncCatalogCache,
  upsertCatalogCacheGame,
} from "./catalogCache";
import { normalizeSteamStoreMetadata } from "./steamMetadata";
import type { CatalogGame, GameDetails, LeaseResponse, SteamMetadata, SteamSearchResponse, UserSummary } from "./types";

const DETAIL_TTL_MS = 10 * 60 * 1000;

let localCatalog: CatalogGame[] = [];
let gameAccessCatalog: CatalogGame[] = [];
let backendCatalogLoadPromise: Promise<CatalogGame[]> | null = null;

interface CatalogAvailability {
  id: number;
  app_id: number | null;
  credit_cost_per_hour: number;
  copies_total: number;
  copies_available: number;
  availability_state: CatalogGame["availability_state"];
  request_count_total: number;
  successful_leases: number;
  demand_value: number;
  price_factor: number;
  pool_value: number;
}

const personalCatalogBuilder = new PersonalCatalog();
const steamMetadataCache = new Map<string, SteamMetadata>();
const gameDetailsResources = new AsyncResourceCache<string, GameDetails>({ ttlMs: DETAIL_TTL_MS });

function detailCacheKey(gameId: number): string {
  return `${getCatalogMode()}|${getAppLocale()}|${gameId}`;
}

async function loadLocalCatalog(): Promise<CatalogGame[]> {
  await narrate(
    "Scanning remembered personal Steam accounts. Propios accepts only verified owned or verified Family-runnable games; local visibility/cache is diagnostic only.",
    { area: "LOCAL STEAM" },
  );
  const pool = await getLocalSteamPool();
  if (!pool) {
    await narrate("The local Steam scan returned no pool. The private/local library cannot be built.", { area: "LOCAL STEAM", level: "WARN" });
    return [];
  }

  await narrate(
    `The local Steam scan found ${pool.accounts.length} remembered account(s) and ${pool.games.length} Windows game record(s). Verified ownership source='${pool.source}', verification_complete=${pool.verification_complete}, verified_at=${pool.verified_at ?? "unknown"}, verified_accounts=${pool.verified_account_count ?? 0}/${pool.accounts.length}.`,
    { area: "LOCAL STEAM" },
  );
  if (pool.ownership_error) {
    await narrate(
      `Ownership verification note: ${pool.ownership_error}. Unverified or visibility-only games cannot enter Propios.`,
      { area: "LOCAL STEAM", level: "WARN" },
    );
  }
  await narrateBatch(
    pool.accounts.map((account) => {
      const label = account.account_name || account.label || "unnamed Steam account";
      const verified = account.ownership_verified
        ? `VERIFIED ownership from ${account.ownership_source ?? pool.source}: ${account.app_ids.length} owned game(s)`
        : "ownership NOT verified";
      const runnable = account.runnable_verified
        ? `${account.runnable_app_ids?.length ?? 0} verified runnable game(s)`
        : "runnable access not verified";
      return `${label}: ${account.active ? "currently active" : "remembered but not active"}; ${verified}; ${runnable}; visible/cache entries=${account.accessible_app_ids.length}.`;
    }),
    { area: "LOCAL STEAM" },
  );

  localCatalog = await applyBundledCatalogArtwork(personalCatalogBuilder.build(pool));
  await narrate(
    `Finished Propios catalog: ${localCatalog.length} game(s), all backed by a verified personal owned or Family-runnable route.`,
    { area: "CATALOG" },
  );
  if (!localCatalog.length) throw new Error("Steam fue detectado pero no hay juegos con una ruta personal verificada para ejecutar.");
  return localCatalog;
}

const localDetails = (game: CatalogGame): GameDetails => ({
  ...game,
  steam: { app_id: game.app_id ?? 0, name: game.name, short_description: "Catálogo personal de GameAccess.", background: game.hero_image ?? undefined },
  metadata_state: "local",
});

async function loadLocalDetails(gameId: number): Promise<GameDetails> {
  const game = localCatalog.find((item) => item.id === gameId || item.app_id === gameId);
  if (!game) throw new Error("Juego no encontrado en el catálogo local");
  if (game.app_id) {
    const metadataKey = `${game.app_id}|${getAppLocale()}`;
    let steam = steamMetadataCache.get(metadataKey);
    if (!steam) {
      try {
        const raw = await getSteamStoreMetadata(game.app_id);
        if (raw) {
          steam = normalizeSteamStoreMetadata(game, raw);
          steamMetadataCache.set(metadataKey, steam);
        }
      } catch {
        // Keep browsing even if Steam Store metadata is temporarily unavailable.
      }
    }
    if (steam) return applyBundledDetails({ ...game, steam, metadata_state: "steam-store" });
  }
  return localDetails(game);
}

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

async function loadBackendCatalogPages(): Promise<CatalogGame[]> {
  const api = await getApiBaseUrl();
  if (!api) throw new Error("El servidor de GameAccess no está configurado.");

  const pageSize = 200;
  const loadPage = async (page: number): Promise<{ games: CatalogGame[]; totalPages: number }> => {
    const startedAt = performance.now();
    await narrate(`Catalog page ${page} request started (page size ${pageSize}).`, { area: "CATALOG" });
    try {
      const response = await fetch(`${api}/catalog?page=${page}&page_size=${pageSize}`, { cache: "no-store", headers: activationHeaders() });
      if (!response.ok) {
        if (response.status === 401) invalidateActivation();
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const games = await response.json() as CatalogGame[];
      const totalPages = Math.max(1, Number(response.headers.get("X-Total-Pages") ?? "1"));
      await narrate(`Catalog page ${page}/${totalPages} loaded ${games.length} entries in ${Math.round(performance.now() - startedAt)} ms.`, { area: "CATALOG" });
      return { games, totalPages };
    } catch (error) {
      await narrate(`Catalog page ${page} request failed after ${Math.round(performance.now() - startedAt)} ms: ${error instanceof Error ? error.message : String(error)}.`, { area: "CATALOG", level: "ERROR" });
      throw error;
    }
  };

  const startedAt = performance.now();
  const first = await loadPage(1);
  if (first.totalPages <= 1) return first.games;

  const games = [...first.games];
  const concurrency = 6;
  for (let page = 2; page <= first.totalPages; page += concurrency) {
    const lastPage = Math.min(first.totalPages, page + concurrency - 1);
    await narrate(`Loading catalog page batch ${page}-${lastPage} of ${first.totalPages} (concurrency ${concurrency}).`, { area: "CATALOG" });
    const batch = await Promise.all(
      Array.from({ length: lastPage - page + 1 }, (_, index) => loadPage(page + index)),
    );
    for (const result of batch) games.push(...result.games);
  }
  await narrate(
    `Loaded ${games.length} GameAccess catalog entries across ${first.totalPages} backend pages in ${Math.round(performance.now() - startedAt)} ms.`,
    { area: "CATALOG" },
  );
  return games;
}

async function computeCachedBackendCatalog(): Promise<CatalogGame[]> {
  const manifestUrl = await getCatalogManifestUrl();
  let cachedGames: CatalogGame[] = [];

  if (manifestUrl) {
    try {
      const sync = await syncCatalogCache(manifestUrl);
      if (sync) {
        await narrate(
          `Catalog cache ${sync.updated ? "updated" : "already current"} at revision ${sync.revision} with ${sync.catalog_count} static game record(s).`,
          { area: "CATALOG" },
        );
      }
    } catch (error) {
      await narrate(
        `Catalog cache synchronization failed; using the last local snapshot if available: ${error instanceof Error ? error.message : String(error)}.`,
        { area: "CATALOG", level: "WARN" },
      );
    }
  }

  cachedGames = await readCatalogCache().catch(() => []);

  if (!cachedGames.length) {
    await narrate("No usable local catalog snapshot is available; loading the full backend catalog as fallback.", { area: "CATALOG", level: "WARN" });
    return loadBackendCatalogPages();
  }

  const availability = await request<CatalogAvailability[]>("/catalog/availability");
  const byId = new Map(cachedGames.map((game) => [game.id, game]));
  const missing = availability.filter((row) => !byId.has(row.id));
  for (const row of missing) {
    try {
      const staticGame = await request<CatalogGame>(`/catalog/static/${row.id}`);
      byId.set(row.id, staticGame);
      await upsertCatalogCacheGame(staticGame);
      await narrate(`Patched catalog cache with newly licensed game ${row.id}.`, { area: "CATALOG" });
    } catch (error) {
      await narrate(
        `Could not patch static metadata for newly licensed game ${row.id}: ${error instanceof Error ? error.message : String(error)}.`,
        { area: "CATALOG", level: "WARN" },
      );
    }
  }

  return availability.flatMap((live) => {
    const staticGame = byId.get(live.id);
    if (!staticGame) return [];
    return [{
      ...staticGame,
      ...live,
    } satisfies CatalogGame];
  });
}

function loadCachedBackendCatalog(): Promise<CatalogGame[]> {
  if (backendCatalogLoadPromise) return backendCatalogLoadPromise;
  backendCatalogLoadPromise = computeCachedBackendCatalog().finally(() => {
    backendCatalogLoadPromise = null;
  });
  return backendCatalogLoadPromise;
}

export async function loadHome(): Promise<{ games: CatalogGame[]; user: UserSummary; offlineDemo: boolean }> {
  const mode = getCatalogMode();
  const api = await getApiBaseUrl();
  await narrate(
    `Loading the ${mode} catalog. Resolved GameAccess server: ${api || "none (offline)"}.`,
    { area: "CATALOG" },
  );

  if (mode === "local") {
    await narrate("Using Propios. This tab never reads or merges GameAccess provider licenses.", { area: "CATALOG" });
    const games = await loadLocalCatalog();
    let user: UserSummary = { id: 1, username: "local", credits: 0 };
    if (api) {
      try {
        user = await request<UserSummary>("/users/1");
      } catch {
        await narrate("Backend user profile unavailable; Propios remains fully local.", { area: "BACKEND", level: "WARN" });
      }
    }
    return { games, user, offlineDemo: false };
  }

  if (mode === "store") {
    await narrate("Using Steam store/discovery mode. This view does not itself claim that a license is available.", { area: "CATALOG" });
    let user: UserSummary = { id: 1, username: "store", credits: 0 };
    if (api) {
      try { user = await request<UserSummary>("/users/1"); }
      catch { await narrate("The server user profile could not be loaded; store browsing remains available.", { area: "BACKEND", level: "WARN" }); }
    }
    return { games: [], user, offlineDemo: false };
  }

  if (!api) {
    await narrate("GameAccess catalog mode requires the backend, but no backend URL resolved. Showing the offline state.", { area: "BACKEND", level: "WARN" });
    return { games: [], user: { id: 1, username: "offline", credits: 0 }, offlineDemo: true };
  }

  await narrate("Requesting the GameAccess-only catalog and current user profile from the backend.", { area: "BACKEND" });
  const catalogLoader = new GameAccessCatalog(loadCachedBackendCatalog);
  const [backendGames, user] = await Promise.all([
    catalogLoader.load(),
    request<UserSummary>("/users/1").catch(() => ({ id: 1, username: "gameaccess", credits: 0 })),
  ]);
  const games = await applyBundledCatalogArtwork(backendGames);
  gameAccessCatalog = games;
  if (!games.length) throw new Error(`GameAccess backend ${api}/catalog returned an empty catalog.`);

  const availabilitySummary = games.reduce(
    (summary, game) => {
      if (game.copies_available > 0) summary.ready += 1;
      else if (game.copies_total > 0) summary.busy += 1;
      else summary.unavailable += 1;
      return summary;
    },
    { ready: 0, busy: 0, unavailable: 0 },
  );
  await narrate(
    `GameAccess availability overlay: ${availabilitySummary.ready} playable now, ${availabilitySummary.busy} owned but busy, ${availabilitySummary.unavailable} unavailable; ${games.length} games total.`,
    { area: "AVAILABILITY" },
  );
  await narrate(`GameAccess backend catalog loaded successfully with ${games.length} game(s).`, { area: "CATALOG" });
  return { games, user, offlineDemo: false };
}

export function findLocalGameForDetails(gameId: number, catalog: CatalogGame[] = localCatalog) {
  return catalog.find((item) => item.id === gameId || item.app_id === gameId);
}

export const loadDetails = async (gameId: number): Promise<GameDetails> => {
  const key = detailCacheKey(gameId);
  return gameDetailsResources.get(key, async () => {
    const startedAt = performance.now();
    await narrate(`Loading game details for catalog game ${gameId} in ${getCatalogMode()} mode.`, { area: "GAME" });
    try {
      let details: GameDetails;
      if (getCatalogMode() === "local") {
        details = await loadLocalDetails(gameId);
      } else {
        const language = getSteamStoreLanguage();
        const current = gameAccessCatalog.find((game) => game.id === gameId);
        const cached = await readCatalogCachedDetail(gameId, language, "ar").catch(() => null);
        if (cached && current) {
          details = await applyBundledDetails({ ...cached, ...current, steam: cached.steam });
          await narrate(`Loaded cached static details for catalog game ${gameId} (${language}/ar).`, { area: "GAME" });
        } else {
          details = await applyBundledDetails(await request<GameDetails>(`/games/${gameId}/details?language=${encodeURIComponent(language)}&country=ar`));
          void storeCatalogCachedDetail(gameId, language, "ar", details).catch(() => undefined);
        }
      }
      await narrate(`Game details loaded for catalog game ${gameId} in ${Math.round(performance.now() - startedAt)} ms.`, { area: "GAME" });
      return details;
    } catch (error) {
      await narrate(`Game details failed for catalog game ${gameId} after ${Math.round(performance.now() - startedAt)} ms: ${error instanceof Error ? error.message : String(error)}.`, { area: "GAME", level: "ERROR" });
      throw new Error(translate("gameDetailsFailed"));
    }
  });
};

export function invalidateDetails(gameId: number): void {
  gameDetailsResources.invalidate(detailCacheKey(gameId));
}

const localSearch = async (query: string, limit = 20): Promise<SteamSearchResponse> => ({
  query,
  count: localCatalog.length,
  results: localCatalog.filter((game) => game.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit).map((game) => ({ app_id: game.app_id ?? 0, name: game.name, image_url: game.header_image, catalog_game: game, access_state: "available", steam_url: game.steam_url ?? undefined })),
});

export const searchSteam = async (query: string, limit = 20): Promise<SteamSearchResponse> => {
  if (getCatalogMode() === "local") return localSearch(query, limit);
  try { return await request<SteamSearchResponse>(`/steam/search?q=${encodeURIComponent(query)}&limit=${limit}`); }
  catch { return { query, count: 0, results: [] }; }
};

export const loadSteamApp = async (appId: number) => {
  if (getCatalogMode() === "local") {
    const game = localCatalog.find((item) => item.app_id === appId);
    if (!game) throw new Error("Juego no encontrado en el catálogo local");
    const details = await loadLocalDetails(game.id);
    if (!details.steam) throw new Error("Steam metadata is unavailable");
    return details.steam;
  }
  return request<SteamMetadata>(`/steam/apps/${appId}?language=${encodeURIComponent(getSteamStoreLanguage())}&country=ar`);
};

export async function releaseFailedLease(lease: LeaseResponse): Promise<void> {
  await Promise.allSettled([
    request(`/leases/${lease.lease_id}/release`, { method: "POST" }),
    request("/credits", {
      method: "POST",
      body: JSON.stringify({
        user_id: 1,
        amount: lease.credits_spent,
        reason: `lease-rollback:${lease.lease_id}:steam-session-failed`,
      }),
    }),
  ]);
}

export interface ProviderLeaseStatus {
  id: number;
  status: "active" | "released" | "expired";
  release_reason: string | null;
  idle_since: string | null;
  last_seen_online_at: string | null;
}

export async function getProviderLeaseStatus(leaseId: number): Promise<ProviderLeaseStatus> {
  return request<ProviderLeaseStatus>(`/leases/${leaseId}`);
}

export async function releaseDownloadFallbackLease(lease: LeaseResponse): Promise<void> {
  await Promise.allSettled([
    request(`/leases/${lease.lease_id}/release`, { method: "POST" }),
    request("/credits", {
      method: "POST",
      body: JSON.stringify({
        user_id: 1,
        amount: lease.credits_spent,
        reason: `lease-release:${lease.lease_id}:download-login-fallback`,
      }),
    }),
  ]);
}

export const leaseGame = async (gameId: number, minutes = 60) => {
  const mode = getCatalogMode();
  await narrate(`Play requested for catalog game id ${gameId} while viewing ${mode}. Evaluating only that tab's license source.`, { area: "LAUNCH" });

  if (mode === "local") {
    const game = localCatalog.find((item) => item.id === gameId);
    if (!game) throw new Error("El juego no pertenece al catálogo Propios actual.");
    const localLease = await tryLocalLease(game, minutes);
    if (localLease) return localLease;
    throw new Error("No hay una cuenta personal verificada que pueda ejecutar este juego.");
  }

  if (mode !== "gameaccess") {
    throw new Error("Esta sección no dispone de una ruta de licencia para ejecutar juegos.");
  }

  const apiBaseUrl = await getApiBaseUrl();
  if (!apiBaseUrl) {
    await narrate("GameAccess play was refused because the shared backend is not connected.", { area: "BACKEND", level: "ERROR" });
    throw new Error("El backend GameAccess no está conectado.");
  }

  await narrate(`Requesting a GameAccess lease for game id ${gameId}. The backend will reuse this installation's current provider account whenever it can run the requested game.`, { area: "BACKEND" });
  const lease = await request<LeaseResponse>("/leases", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, minutes }),
  });
  await narrate(
    `Backend lease ${lease.lease_id} assigned account '${lease.account?.label ?? "unknown"}' with session_action='${lease.session_action}'.`,
    { area: "AVAILABILITY" },
  );
  if (lease.session_action === "provider_adapter_required") {
    if (!lease.account?.label) {
      await narrate("The backend created a lease but did not provide a Steam provider profile. Releasing the failed lease.", { area: "ERROR", level: "ERROR" });
      await releaseFailedLease(lease);
      throw new Error("La reserva no tiene un perfil Steam asociado.");
    }
    try {
      await narrate(`Preparing the assigned Steam provider session for lease ${lease.lease_id}. The credential envelope is fetched and decrypted only by native Tauri code and is never persisted by GameAccess.`, { area: "ACCOUNT" });
      await loginProviderSteam(lease.lease_id, apiBaseUrl);
      await narrate(`Assigned Steam provider session is ready. Lease ${lease.lease_id} can launch the game.`, { area: "ACCOUNT" });
      return { ...lease, session_action: "launch_ready" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await narrate(`Provider Steam preparation failed for lease ${lease.lease_id}: ${message}. Releasing the lease.`, { area: "ERROR", level: "ERROR" });
      await releaseFailedLease(lease);
      throw error;
    }
  }
  return lease;
};

async function tryLocalLease(game: CatalogGame, minutes: number) {
  const configured = game.local_primary_account_label ?? game.local_account_labels?.[0];
  if (!configured) return null;

  await narrate(`${game.name}: using verified personal runnable account '${configured}'.`, { area: "ACCOUNT" });
  await switchSteamAccount(configured);
  const now = Date.now();
  return {
    lease_id: now,
    game: { id: game.id, name: game.name, app_id: game.app_id },
    account: { id: 0, label: configured, provider: "steam" },
    credits_spent: 0,
    credits_remaining: 0,
    starts_at: new Date(now).toISOString(),
    expires_at: new Date(now + minutes * 60_000).toISOString(),
    session_action: "launch_ready",
  };
}
