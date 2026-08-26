import type { CatalogGame, GameDetails, LeaseResponse, UserSummary } from "./types";

const API = import.meta.env.VITE_GAMEACCESS_API ?? "http://127.0.0.1:8000";

const steamAssets = (appId: number) => ({
  header_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
  capsule_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
  hero_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
  steam_url: `https://store.steampowered.com/app/${appId}/`,
});

export const fallbackCatalog: CatalogGame[] = [
  {
    id: 1,
    slug: "no-mans-sky",
    name: "No Man's Sky",
    app_id: 275850,
    credit_cost_per_hour: 100,
    copies_total: 1,
    copies_available: 1,
    availability_state: "ready",
    ...steamAssets(275850),
  },
  {
    id: 2,
    slug: "cyberpunk-2077",
    name: "Cyberpunk 2077",
    app_id: 1091500,
    credit_cost_per_hour: 150,
    copies_total: 2,
    copies_available: 1,
    availability_state: "ready",
    ...steamAssets(1091500),
  },
  {
    id: 3,
    slug: "fc",
    name: "EA Sports FC",
    app_id: null,
    credit_cost_per_hour: 180,
    copies_total: 0,
    copies_available: 0,
    availability_state: "unavailable",
  },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      // keep HTTP status fallback
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function loadHome(): Promise<{ games: CatalogGame[]; user: UserSummary; offlineDemo: boolean }> {
  try {
    const [games, user] = await Promise.all([
      request<CatalogGame[]>("/catalog"),
      request<UserSummary>("/users/1"),
    ]);
    return { games, user, offlineDemo: false };
  } catch {
    return {
      games: fallbackCatalog,
      user: { id: 1, username: "demo", credits: 1500 },
      offlineDemo: true,
    };
  }
}

export const loadDetails = (gameId: number) => request<GameDetails>(`/games/${gameId}/details`);

export const leaseGame = (gameId: number, minutes = 60) =>
  request<LeaseResponse>("/leases", {
    method: "POST",
    body: JSON.stringify({ user_id: 1, game_id: gameId, minutes }),
  });

export const importSteamGame = (appId: number) =>
  request<{ created: boolean; game: CatalogGame }>(`/admin/games/import-steam/${appId}`, { method: "POST" });

export const apiBase = API;
