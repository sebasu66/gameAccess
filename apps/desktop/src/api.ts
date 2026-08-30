import { getLocalSteamPool, switchSteamAccount } from "./native";
import { buildLocalCatalog, mergeCatalog } from "./catalog";
import type { CatalogGame, GameDetails, LeaseResponse, SteamMetadata, SteamSearchResponse, UserSummary } from "./types";

// Set this to the hosted backend (or the local FastAPI emulator during development).
// An empty value deliberately means offline mode; no localhost server is required.
const API = (import.meta.env.VITE_GAMEACCESS_API ?? "").replace(/\/$/, "");

let localCatalog: CatalogGame[] = [];

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API) throw new Error("Online backend is not configured");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function loadHome(): Promise<{ games: CatalogGame[]; user: UserSummary; offlineDemo: boolean }> {
  const local = await loadLocalCatalog();
  try {
    const [games, user] = await Promise.all([request<CatalogGame[]>("/catalog"), request<UserSummary>("/users/1")]);
    return { games: mergeCatalog(games, local), user, offlineDemo: false };
  } catch {
    return { games: local, user: { id: 1, username: "offline", credits: 0 }, offlineDemo: true };
  }
}

export const loadDetails = async (gameId: number) => {
  try { return await request<GameDetails>(`/games/${gameId}/details`); }
  catch {
    const game = localCatalog.find((item) => item.id === gameId);
    if (!game) throw new Error("Juego no encontrado en el catálogo local");
    return localDetails(game);
  }
};

const localSearch = async (query: string, limit = 20): Promise<SteamSearchResponse> => ({
  query,
  count: localCatalog.length,
  results: localCatalog.filter((game) => game.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit).map((game) => ({ app_id: game.app_id ?? 0, name: game.name, image_url: game.header_image, catalog_game: game, access_state: game.copies_available > 0 ? "available" : game.copies_total > 0 ? "busy" : "not-in-pool", steam_url: game.steam_url ?? undefined })),
});

export const searchSteam = async (query: string, limit = 20): Promise<SteamSearchResponse> => {
  try { return await request<SteamSearchResponse>(`/steam/search?q=${encodeURIComponent(query)}&limit=${limit}`); }
  catch { return localSearch(query, limit); }
};

export const loadSteamApp = async (appId: number) => {
  try { return await request<SteamMetadata>(`/steam/apps/${appId}`); }
  catch {
    const game = localCatalog.find((item) => item.app_id === appId);
    if (!game) throw new Error("Juego no encontrado en el catálogo local");
    return localDetails(game).steam!;
  }
};

async function rollbackFailedLease(lease: LeaseResponse): Promise<void> {
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

export const leaseGame = async (gameId: number, minutes = 60) => {
  const game = localCatalog.find((item) => item.id === gameId);
  if (API) {
    const lease = await request<LeaseResponse>("/leases", { method: "POST", body: JSON.stringify({ user_id: 1, game_id: gameId, minutes }) });
    if (lease.session_action === "provider_adapter_required") {
      if (!lease.account?.label) {
        await rollbackFailedLease(lease);
        throw new Error("La reserva no tiene un perfil Steam asociado.");
      }
      try {
        await switchSteamAccount(lease.account.label);
        return { ...lease, session_action: "launch_ready" };
      } catch (error) {
        await rollbackFailedLease(lease);
        throw error;
      }
    }
    return lease;
  }
  if (!game) throw new Error("Juego no encontrado en el catálogo local");
  const configured = game.local_primary_account_label ?? game.local_account_labels?.[0];
  if (!configured) throw new Error("No hay una cuenta Steam local verificada que pueda abrir este juego.");
  await switchSteamAccount(configured);
  const now = Date.now();
  return {
    lease_id: now,
    game: { id: game.id, name: game.name, app_id: game.app_id },
    account: { id: 0, label: "local", provider: "steam" },
    credits_spent: game.credit_cost_per_hour,
    credits_remaining: Math.max(0, 1500 - game.credit_cost_per_hour),
    starts_at: new Date(now).toISOString(),
    expires_at: new Date(now + minutes * 60_000).toISOString(),
    session_action: "launch_ready",
  };
};
