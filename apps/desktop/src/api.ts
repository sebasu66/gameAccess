import { AsyncResourceCache } from "./asyncResourceCache";
import { buildLocalCatalog } from "./catalog";
import { getCatalogMode } from "./catalogMode";
import { getLocalSteamPool, getSteamSessionStatus, getSteamStoreMetadata, loginProviderSteam, switchSteamAccount } from "./native";
import { getApiBaseUrl } from "./settings";
import { normalizeSteamStoreMetadata } from "./steamMetadata";
import type { CatalogGame, GameDetails, LeaseResponse, SteamMetadata, SteamSearchResponse, UserSummary } from "./types";

const DETAIL_TTL_MS = 10 * 60 * 1000;

let localCatalog: CatalogGame[] = [];

const steamMetadataCache = new Map<number, SteamMetadata>();
const gameDetailsResources = new AsyncResourceCache<string, GameDetails>({ ttlMs: DETAIL_TTL_MS });

function detailCacheKey(gameId: number): string {
  return `${getCatalogMode()}|${gameId}`;
}

async function loadLocalCatalog(): Promise<CatalogGame[]> {
  const pool = await getLocalSteamPool();
  if (!pool) return [];
  localCatalog = buildLocalCatalog(pool);
  if (!localCatalog.length) throw new Error("Steam fue detectado pero el inventario local no devolvió juegos.");
  return localCatalog;
}

const localDetails = (game: CatalogGame): GameDetails => ({
  ...game,
  steam: { app_id: game.app_id ?? 0, name: game.name, short_description: "Catálogo local de gameAccess.", background: game.hero_image ?? undefined },
  metadata_state: "local",
});

async function loadLocalDetails(gameId: number): Promise<GameDetails> {
  const game = localCatalog.find((item) => item.id === gameId || item.app_id === gameId);
  if (!game) throw new Error("Juego no encontrado en el catálogo local");
  if (game.app_id) {
    let steam = steamMetadataCache.get(game.app_id);
    if (!steam) {
      try {
        const raw = await getSteamStoreMetadata(game.app_id);
        if (raw) {
          steam = normalizeSteamStoreMetadata(game, raw);
          steamMetadataCache.set(game.app_id, steam);
        }
      } catch {
        // Keep browsing even if Steam Store metadata is temporarily unavailable.
      }
    }
    if (steam) return { ...game, steam, metadata_state: "steam-store" };
  }
  return localDetails(game);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const api = await getApiBaseUrl();
  if (!api) throw new Error("Online backend is not configured");
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (body?.detail) detail = `${response.status} ${String(body.detail)}`;
    } catch {
      // Keep the HTTP status when the backend did not return JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function loadHome(): Promise<{ games: CatalogGame[]; user: UserSummary; offlineDemo: boolean }> {
  const mode = getCatalogMode();
  const api = await getApiBaseUrl();

  if (mode === "local") {
    const games = await loadLocalCatalog();
    let user: UserSummary = { id: 1, username: "local", credits: 0 };
    if (api) {
      try { user = await request<UserSummary>("/users/1"); } catch { /* local library does not depend on backend */ }
    }
    return { games, user, offlineDemo: false };
  }

  if (mode === "store") {
    let user: UserSummary = { id: 1, username: "store", credits: 0 };
    if (api) {
      try { user = await request<UserSummary>("/users/1"); } catch { /* store shell stays browsable */ }
    }
    return { games: [], user, offlineDemo: false };
  }

  if (!api) {
    return { games: [], user: { id: 1, username: "offline", credits: 0 }, offlineDemo: true };
  }

  const [games, user] = await Promise.all([
    request<CatalogGame[]>("/catalog"),
    request<UserSummary>("/users/1").catch(() => ({ id: 1, username: "gameaccess", credits: 0 })),
  ]);
  if (!games.length) throw new Error(`GameAccess backend ${api}/catalog returned an empty catalog.`);
  return { games, user, offlineDemo: false };
}

export function findLocalGameForDetails(gameId: number, catalog: CatalogGame[] = localCatalog) {
  return catalog.find((item) => item.id === gameId || item.app_id === gameId);
}

export const loadDetails = async (gameId: number): Promise<GameDetails> => {
  const key = detailCacheKey(gameId);
  return gameDetailsResources.get(key, async () => {
    if (getCatalogMode() === "local") return loadLocalDetails(gameId);
    try {
      return await request<GameDetails>(`/games/${gameId}/details`);
    } catch {
      // Never fall through to localCatalog outside Local mode. A Steam AppID
      // may intentionally exist in both catalogs with different license routes.
      throw new Error("No se pudo obtener la ficha del juego");
    }
  });
};

export function invalidateDetails(gameId: number): void {
  gameDetailsResources.invalidate(detailCacheKey(gameId));
}

const localSearch = async (query: string, limit = 20): Promise<SteamSearchResponse> => ({
  query,
  count: localCatalog.length,
  results: localCatalog.filter((game) => game.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit).map((game) => ({ app_id: game.app_id ?? 0, name: game.name, image_url: game.header_image, catalog_game: game, access_state: game.local_primary_account_label || game.copies_available > 0 ? "available" : game.copies_total > 0 ? "busy" : "not-in-pool", steam_url: game.steam_url ?? undefined })),
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
  return request<SteamMetadata>(`/steam/apps/${appId}`);
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
  // An AppID can exist in both catalogs. Only Local mode may route through a
  // remembered personal account; GameAccess mode must always lease remotely.
  const game = getCatalogMode() === "local"
    ? localCatalog.find((item) => item.id === gameId)
    : undefined;

  if (game) {
    const configured = game.local_primary_account_label ?? game.local_account_labels?.[0];
    if (!configured) throw new Error("No hay una cuenta Steam local verificada que pueda abrir este juego.");
    await switchSteamAccount(configured);
    const now = Date.now();
    return {
      lease_id: now,
      game: { id: game.id, name: game.name, app_id: game.app_id },
      account: { id: 0, label: "local", provider: "steam" },
      credits_spent: 0,
      credits_remaining: 0,
      starts_at: new Date(now).toISOString(),
      expires_at: new Date(now + minutes * 60_000).toISOString(),
      session_action: "launch_ready",
    };
  }

  if (!(await getApiBaseUrl())) throw new Error("El backend GameAccess no está conectado.");

  const session = await getSteamSessionStatus().catch(() => null);
  if (session && session.appId && !session.done && session.phase !== "idle") {
    throw new Error("Ya hay un juego en ejecución. Cerralo antes de iniciar otro.");
  }

  const lease = await request<LeaseResponse>("/leases", {
    method: "POST",
    body: JSON.stringify({ user_id: 1, game_id: gameId, minutes, replace_existing: true }),
  });
  if (lease.session_action === "provider_adapter_required") {
    if (!lease.account?.label) {
      await releaseFailedLease(lease);
      throw new Error("La reserva no tiene un perfil Steam asociado.");
    }
    try {
      const credentials = await request<{ accountName: string; password: string; expectedUserId32: number }>(`/leases/${lease.lease_id}/steam-login`, { method: "POST" });
      await loginProviderSteam(credentials);
      return { ...lease, session_action: "launch_ready" };
    } catch (error) {
      await releaseFailedLease(lease);
      throw error;
    }
  }
  return lease;
};
