import { switchSteamAccount } from "./native";
import type { CatalogGame, GameDetails, LeaseResponse, UserSummary } from "./types";

const API = import.meta.env.VITE_GAMEACCESS_API ?? "http://127.0.0.1:8000";

const steamAssets = (appId: number) => ({
  header_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
  capsule_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
  hero_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
  steam_url: `https://store.steampowered.com/app/${appId}/`,
});

const demoGame = (
  id: number,
  slug: string,
  name: string,
  appId: number,
  credits: number,
  total: number,
  available: number,
): CatalogGame => ({
  id,
  slug,
  name,
  app_id: appId,
  credit_cost_per_hour: credits,
  copies_total: total,
  copies_available: available,
  availability_state: available > 0 ? "ready" : total > 0 ? "owned-busy" : "unavailable",
  ...steamAssets(appId),
});

export const fallbackCatalog: CatalogGame[] = [
  demoGame(1, "cyberpunk-2077", "Cyberpunk 2077", 1091500, 150, 2, 1),
  demoGame(2, "no-mans-sky", "No Man's Sky", 275850, 100, 1, 1),
  demoGame(3, "elden-ring", "ELDEN RING", 1245620, 180, 2, 1),
  demoGame(4, "baldurs-gate-3", "Baldur's Gate 3", 1086940, 170, 1, 0),
  demoGame(5, "hogwarts-legacy", "Hogwarts Legacy", 990080, 120, 1, 1),
  demoGame(6, "forza-horizon-5", "Forza Horizon 5", 1551360, 130, 0, 0),
  demoGame(7, "helldivers-2", "HELLDIVERS 2", 553850, 160, 2, 2),
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

export async function leaseGame(gameId: number, minutes = 60): Promise<LeaseResponse> {
  const lease = await request<LeaseResponse>("/leases", {
    method: "POST",
    body: JSON.stringify({ user_id: 1, game_id: gameId, minutes }),
  });

  if (lease.session_action !== "provider_adapter_required") return lease;
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

export const importSteamGame = (appId: number) =>
  request<{ created: boolean; game: CatalogGame }>(`/admin/games/import-steam/${appId}`, { method: "POST" });

export const apiBase = API;
