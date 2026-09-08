import type { LocalSteamPool } from "./native";
import { narrateBatch } from "./narrationLog";
import type { CatalogGame } from "./types";

const steamAssets = (appId: number) => ({
  header_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
  capsule_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
  hero_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
  steam_url: `https://store.steampowered.com/app/${appId}/`,
});


export function buildLocalCatalog(pool: LocalSteamPool): CatalogGame[] {
  const accounts = pool.accounts ?? [];
  const decisions: string[] = [];
  const catalog = (pool.games ?? []).flatMap((item): CatalogGame[] => {
    const owners = accounts
      .filter((account) => account.ownership_verified === true && account.app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));
    const runnable = accounts
      .filter((account) =>
        (account.runnable_verified === true && (account.runnable_app_ids ?? []).includes(item.app_id))
        || (account.ownership_verified === true && account.app_ids.includes(item.app_id)))
      .sort((left, right) => Number(right.active) - Number(left.active));
    const visible = accounts
      .filter((account) => account.accessible_app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));

    if (!owners.length && !runnable.length && !visible.length) return [];

    const ownerLabels = owners.map((account) => account.account_name || account.label);
    const runnableLabels = runnable.map((account) => account.account_name || account.label);
    const visibleLabels = visible.map((account) => account.account_name || account.label);
    decisions.push(
      `${item.name} (Steam AppID ${item.app_id}). Visible accounts: ${visibleLabels.join(", ") || "none"}. Original owners: ${ownerLabels.join(", ") || "none"}. Verified runnable accounts (owned or Family-borrowed): ${runnableLabels.join(", ") || "none"}. Decision: ${runnable.length ? "AVAILABLE locally." : "NOT AVAILABLE locally; visibility alone is not enough."}`,
    );

    // Runnable seats can share one physical Family license, so local availability
    // is binary unless we also know multiple original-owner copies.
    const copiesTotal = Math.max(owners.length, runnable.length ? 1 : 0);
    const copiesAvailable = runnable.length ? Math.max(owners.length, 1) : 0;
    return [{
      id: item.app_id,
      slug: `steam-${item.app_id}`,
      name: item.name,
      app_id: item.app_id,
      credit_cost_per_hour: 0,
      copies_total: copiesTotal,
      copies_available: copiesAvailable,
      availability_state: runnable.length ? "ready" : "unavailable",
      local_account_labels: runnableLabels,
      local_access_labels: visibleLabels,
      local_primary_account_label: runnable[0]?.account_name || runnable[0]?.label,
      local_owner_steam_ids: owners.map((account) => account.steam_id64).filter((value): value is string => Boolean(value)),
      local_inventory_verified: runnable.length > 0,
      local_inventory_verified_at: pool.verified_at,
      ...steamAssets(item.app_id),
    }];
  });

  void narrateBatch(decisions, { area: "AVAILABILITY" });
  return catalog;
}

export function mergeLocalWithBackendCatalog(local: CatalogGame[], remote: CatalogGame[]): CatalogGame[] {
  const byApp = new Map<number, CatalogGame>();
  for (const game of remote) if (game.app_id) byApp.set(game.app_id, game);
  return local.map((localGame) => {
    const server = localGame.app_id ? byApp.get(localGame.app_id) : undefined;
    if (!server) return localGame;
    const localRunnable = Boolean(localGame.local_primary_account_label) && localGame.copies_available > 0;
    return {
      ...localGame,
      id: server.id,
      backend_game_id: server.id,
      remote_copies_total: server.copies_total,
      remote_copies_available: server.copies_available,
      credit_cost_per_hour: localRunnable ? localGame.credit_cost_per_hour : server.credit_cost_per_hour,
      copies_total: localRunnable ? localGame.copies_total : server.copies_total,
      copies_available: localRunnable ? localGame.copies_available : server.copies_available,
      availability_state: localRunnable
        ? "ready"
        : (server.availability_state ?? (server.copies_available > 0 ? "ready" : server.copies_total > 0 ? "owned-busy" : "unavailable")),
    };
  });
}

export function mergeCatalog(remote: CatalogGame[], local: CatalogGame[]): CatalogGame[] {
  const byApp = new Map<number, CatalogGame>();
  for (const game of local) if (game.app_id) byApp.set(game.app_id, game);
  for (const game of remote) {
    const appId = game.app_id;
    const localGame = appId ? byApp.get(appId) : undefined;
    if (localGame && appId) {
      byApp.set(appId, {
        ...game,
        copies_total: localGame.copies_total,
        copies_available: localGame.copies_available,
        availability_state: localGame.availability_state,
        local_account_labels: localGame.local_account_labels,
        local_access_labels: localGame.local_access_labels,
        local_primary_account_label: localGame.local_primary_account_label,
        local_owner_steam_ids: localGame.local_owner_steam_ids,
        local_inventory_verified: localGame.local_inventory_verified,
        local_inventory_verified_at: localGame.local_inventory_verified_at,
      });
    } else if (appId) byApp.set(appId, game);
  }
  return [...byApp.values(), ...remote.filter((game) => !game.app_id)];
}
