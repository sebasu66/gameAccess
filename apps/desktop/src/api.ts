import { getLocalSteamPool, getSteamStoreMetadata, switchSteamAccount, loginProviderSteam } from "./native";
import { buildLocalCatalog } from "./catalog";
import { getCatalogMode } from "./catalogMode";
import type { CatalogGame, GameDetails, LeaseResponse, SteamMetadata, SteamSearchResponse, UserSummary } from "./types";

// Set this to the hosted backend (or the local FastAPI emulator during development).
// An empty value deliberately means offline mode; no localhost server is required.
const DEFAULT_API = "http://127.0.0.1:38147";
const API = (import.meta.env.VITE_GAMEACCESS_API ?? DEFAULT_API).replace(/\/$/, "");

let localCatalog: CatalogGame[] = [];

const steamMetadataCache = new Map<number, SteamMetadata>();
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

function normalizeSteamStoreMetadata(game: CatalogGame, raw: Record<string, unknown>): SteamMetadata {
  const data = record(raw);
  const release = record(data.release_date);
  const requirements = record(data.pc_requirements);
  const price = record(data.price_overview);
  const platforms = record(data.platforms);
  const recommendations = record(data.recommendations);
  const achievements = record(data.achievements);
  const metacritic = record(data.metacritic);

  const screenshots = Array.isArray(data.screenshots) ? data.screenshots.map((value: unknown) => {
    const shot = record(value);
    return {
      id: Number(shot.id) || undefined,
      thumbnail: String(shot.path_thumbnail || "") || undefined,
      full: String(shot.path_full || "") || undefined,
    };
  }) : [];

  const movies = Array.isArray(data.movies) ? data.movies.map((value: unknown) => {
    const movie = record(value);
    const mp4 = record(movie.mp4);
    const webm = record(movie.webm);
    return {
      id: Number(movie.id) || undefined,
      name: String(movie.name || "") || undefined,
      thumbnail: String(movie.thumbnail || "") || undefined,
      mp4: String(mp4.max || mp4["480"] || "") || undefined,
      webm: String(webm.max || webm["480"] || "") || undefined,
      highlight: Boolean(movie.highlight),
    };
  }) : [];

  const genres = Array.isArray(data.genres)
    ? data.genres.map((value: unknown) => String(record(value).description || "")).filter(Boolean)
    : [];
  const categories = Array.isArray(data.categories)
    ? data.categories.map((value: unknown) => String(record(value).description || "")).filter(Boolean)
    : [];

  return {
    app_id: game.app_id ?? (Number(data.steam_appid) || 0),
    name: String(data.name || game.name),
    short_description: String(data.short_description || "") || undefined,
    about_the_game: String(data.about_the_game || "") || undefined,
    detailed_description: String(data.detailed_description || "") || undefined,
    developers: Array.isArray(data.developers) ? data.developers.map(String) : [],
    publishers: Array.isArray(data.publishers) ? data.publishers.map(String) : [],
    genres,
    categories,
    supported_languages: String(data.supported_languages || "") || undefined,
    release_date: String(release.date || "") || undefined,
    coming_soon: Boolean(release.coming_soon),
    required_age: data.required_age as number | string | undefined,
    metacritic: metacritic.score
      ? { score: Number(metacritic.score), url: String(metacritic.url || "") || undefined }
      : null,
    recommendation_count: Number(recommendations.total) || undefined,
    achievement_count: Number(achievements.total) || undefined,
    price: Object.keys(price).length ? {
      currency: String(price.currency || "") || undefined,
      initial: Number(price.initial) || undefined,
      final: Number(price.final) || undefined,
      discount_percent: Number(price.discount_percent) || 0,
      initial_formatted: String(price.initial_formatted || "") || undefined,
      final_formatted: String(price.final_formatted || "") || undefined,
    } : null,
    is_free: Boolean(data.is_free),
    windows: Boolean(platforms.windows),
    mac: Boolean(platforms.mac),
    linux: Boolean(platforms.linux),
    minimum_requirements: String(requirements.minimum || "") || undefined,
    recommended_requirements: String(requirements.recommended || "") || undefined,
    screenshots,
    movies,
    header_image: String(data.header_image || game.header_image || "") || undefined,
    capsule_image: game.capsule_image ?? undefined,
    hero_image: String(data.background_raw || data.background || game.hero_image || "") || undefined,
    background: String(data.background_raw || data.background || game.hero_image || "") || undefined,
    steam_url: game.steam_url ?? undefined,
    source: "steam-store",
  };
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
  if (!API) throw new Error("Online backend is not configured");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function loadHome(): Promise<{ games: CatalogGame[]; user: UserSummary; offlineDemo: boolean }> {
  const mode = getCatalogMode();

  if (mode === "local") {
    const games = await loadLocalCatalog();
    let user: UserSummary = { id: 1, username: "local", credits: 0 };
    if (API) {
      try { user = await request<UserSummary>("/users/1"); } catch { /* local library does not depend on backend */ }
    }
    return { games, user, offlineDemo: false };
  }

  if (mode === "store") {
    let user: UserSummary = { id: 1, username: "store", credits: 0 };
    if (API) {
      try { user = await request<UserSummary>("/users/1"); } catch { /* store shell stays browsable */ }
    }
    return { games: [], user, offlineDemo: false };
  }

  if (!API) {
    return { games: [], user: { id: 1, username: "offline", credits: 0 }, offlineDemo: true };
  }

  const [games, user] = await Promise.all([
    request<CatalogGame[]>("/catalog"),
    request<UserSummary>("/users/1").catch(() => ({ id: 1, username: "gameaccess", credits: 0 })),
  ]);
  if (!games.length) throw new Error(`GameAccess backend ${API}/catalog returned an empty catalog.`);
  return { games, user, offlineDemo: false };
}

export function findLocalGameForDetails(gameId: number, catalog: CatalogGame[] = localCatalog) {
  return catalog.find((item) => item.id === gameId || item.app_id === gameId);
}

export const loadDetails = async (gameId: number) => {
  if (getCatalogMode() === "local") return loadLocalDetails(gameId);
  try {
    return await request<GameDetails>(`/games/${gameId}/details`);
  } catch {
    if (findLocalGameForDetails(gameId)) return loadLocalDetails(gameId);
    throw new Error("No se pudo obtener la ficha del juego");
  }
};

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

  if (!API) throw new Error("El backend GameAccess no está conectado.");

  const lease = await request<LeaseResponse>("/leases", { method: "POST", body: JSON.stringify({ user_id: 1, game_id: gameId, minutes }) });
  if (lease.session_action === "provider_adapter_required") {
    if (!lease.account?.label) {
      await rollbackFailedLease(lease);
      throw new Error("La reserva no tiene un perfil Steam asociado.");
    }
    try {
      const credentials = await request<{ accountName: string; password: string; expectedUserId32: number }>(`/leases/${lease.lease_id}/steam-login`, { method: "POST" });
      await loginProviderSteam(credentials);
      return { ...lease, session_action: "launch_ready" };
    } catch (error) {
      await rollbackFailedLease(lease);
      throw error;
    }
  }
  return lease;
};
