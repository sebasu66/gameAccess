import { AsyncResourceCache } from "./asyncResourceCache";
import { buildLocalCatalog } from "./catalog";
import { getCatalogMode } from "./catalogMode";
import { narrate, narrateBatch } from "./narrationLog";
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
  await narrate(
    "Scanning local Steam data for remembered personal accounts and locally visible games. Visibility and ownership-candidate lists will be kept separate.",
    { area: "LOCAL STEAM" },
  );
  const pool = await getLocalSteamPool();
  if (!pool) {
    await narrate("The local Steam scan returned no pool. The private/local library cannot be built.", { area: "LOCAL STEAM", level: "WARN" });
    return [];
  }

  await narrate(
    `The local Steam scan found ${pool.accounts.length} remembered account(s) and ${pool.games.length} Windows game record(s). Scanner verification_complete=${pool.verification_complete}.`,
    { area: "LOCAL STEAM" },
  );
  await narrateBatch(
    pool.accounts.map((account) => {
      const label = account.account_name || account.label || "unnamed Steam account";
      return `${label}: ${account.active ? "currently active" : "remembered but not active"}; app_ids ownership candidates=${account.app_ids.length}; accessible_app_ids visibility/access entries=${account.accessible_app_ids.length}. These two lists are intentionally not treated as the same thing.`;
    }),
    { area: "LOCAL STEAM" },
  );

  localCatalog = buildLocalCatalog(pool);
  const available = localCatalog.filter((game) => game.copies_available > 0).length;
  const unavailable = localCatalog.length - available;
  await narrate(
    `Finished building the private/local library: ${localCatalog.length} visible game(s), ${available} currently marked playable, ${unavailable} visible but not playable by the current local-license rule.`,
    { area: "CATALOG" },
  );
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
  if (!api) {
    await narrate(`Backend request ${init?.method ?? "GET"} ${path} was skipped because no GameAccess server URL is configured.`, { area: "BACKEND", level: "WARN" });
    throw new Error("Online backend is not configured");
  }

  const method = init?.method ?? "GET";
  await narrate(`Sending ${method} ${path} to the GameAccess backend at ${api}.`, { area: "BACKEND" });
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
    await narrate(`Backend request ${method} ${path} failed: ${detail}.`, { area: "BACKEND", level: "ERROR" });
    throw new Error(detail);
  }
  await narrate(`Backend request ${method} ${path} succeeded with HTTP ${response.status}.`, { area: "BACKEND" });
  return response.json() as Promise<T>;
}


export async function loadHome(): Promise<{ games: CatalogGame[]; user: UserSummary; offlineDemo: boolean }> {
  const mode = getCatalogMode();
  const api = await getApiBaseUrl();
  await narrate(
    `Loading the ${mode} catalog. Resolved GameAccess server: ${api || "none (offline)"}.`,
    { area: "CATALOG" },
  );

  if (mode === "local") {
    await narrate("Using the private/local Steam library. Games may be visible through Steam access even when no local ownership candidate is available.", { area: "CATALOG" });
    const games = await loadLocalCatalog();
    let user: UserSummary = { id: 1, username: "local", credits: 0 };
    if (api) {
      try { user = await request<UserSummary>("/users/1"); }
      catch { await narrate("The server user profile could not be loaded, but the private/local library can continue independently.", { area: "BACKEND", level: "WARN" }); }
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

  await narrate("Requesting the shared GameAccess game catalog and current user profile from the backend.", { area: "BACKEND" });
  const [games, user] = await Promise.all([
    request<CatalogGame[]>("/catalog"),
    request<UserSummary>("/users/1").catch(() => ({ id: 1, username: "gameaccess", credits: 0 })),
  ]);
  if (!games.length) throw new Error(`GameAccess backend ${api}/catalog returned an empty catalog.`);

  void narrateBatch(
    games.map((game) => {
      const decision = game.copies_available > 0
        ? `PLAYABLE NOW because the server reports ${game.copies_available} available license copy/copies.`
        : game.copies_total > 0
          ? `NOT PLAYABLE NOW because all ${game.copies_total} known license copy/copies are currently unavailable.`
          : "NOT PLAYABLE NOW because the server reports zero license copies for this game.";
      return `${game.name}${game.app_id ? ` (Steam AppID ${game.app_id})` : ""}. Server license state: copies_total=${game.copies_total}, copies_available=${game.copies_available}, availability_state=${game.availability_state}. Decision: ${decision}`;
    }),
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
  const mode = getCatalogMode();
  await narrate(`Play requested for catalog game id ${gameId} while viewing ${mode}. Evaluating which account/license route is allowed.`, { area: "LAUNCH" });

  const game = getCatalogMode() === "local"
    ? localCatalog.find((item) => item.id === gameId)
    : undefined;

  if (game) {
    const configured = game.local_primary_account_label ?? game.local_account_labels?.[0];
    if (!configured) {
      await narrate(
        `${game.name}: local play was refused because no local owner candidate is configured. Being visible through Steam access is not enough.`,
        { area: "AVAILABILITY", level: "WARN" },
      );
      throw new Error("No hay una cuenta Steam local verificada que pueda abrir este juego.");
    }
    await narrate(`${game.name}: local rule selected remembered Steam account '${configured}'. Switching to that account before launch.`, { area: "ACCOUNT" });
    await switchSteamAccount(configured);
    const now = Date.now();
    await narrate(`${game.name}: local account switch completed. The local launch route is ready.`, { area: "LAUNCH" });
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

  if (!(await getApiBaseUrl())) {
    await narrate("GameAccess play was refused because the shared backend is not connected.", { area: "BACKEND", level: "ERROR" });
    throw new Error("El backend GameAccess no está conectado.");
  }

  await narrate("Checking whether GameAccess already has a tracked Steam game session running on this PC.", { area: "LAUNCH" });
  const session = await getSteamSessionStatus().catch(() => null);
  if (session && session.appId && !session.done && session.phase !== "idle") {
    await narrate(`Another tracked game session is still active for Steam AppID ${session.appId}. A new account/license switch is blocked until it closes.`, { area: "LAUNCH", level: "WARN" });
    throw new Error("Ya hay un juego en ejecución. Cerralo antes de iniciar otro.");
  }

  await narrate(`Requesting a GameAccess license lease for game id ${gameId}. Stale inactive leases may be replaced.`, { area: "BACKEND" });
  const lease = await request<LeaseResponse>("/leases", {
    method: "POST",
    body: JSON.stringify({ user_id: 1, game_id: gameId, minutes, replace_existing: true }),
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
      await narrate(`Preparing provider Steam account '${lease.account.label}' for the leased game. Credentials are requested securely and are never written to this log.`, { area: "ACCOUNT" });
      const credentials = await request<{ accountName: string; password: string; expectedUserId32: number }>(`/leases/${lease.lease_id}/steam-login`, { method: "POST" });
      await loginProviderSteam(credentials);
      await narrate(`Provider Steam account '${credentials.accountName}' is ready. Lease ${lease.lease_id} can launch the game.`, { area: "ACCOUNT" });
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
