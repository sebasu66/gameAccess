import type { LocalSteamPool } from "./native";
import type { CatalogGame } from "./types";

const steamAssets = (appId: number) => ({
  header_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
  capsule_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
  hero_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
  steam_url: `https://store.steampowered.com/app/${appId}/`,
});

export function buildLocalCatalog(pool: LocalSteamPool): CatalogGame[] {
  const accounts = pool.accounts ?? [];
  return (pool.games ?? []).flatMap((item) => {
    const owners = accounts
      .filter((account) => account.app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));
    const accessible = accounts
      .filter((account) => account.accessible_app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));

    // The local library is discovery/access, not the leasing inventory. A game
    // remains visible when Steam exposes it to a remembered account even before
    // licenses_print has verified the original owner. Ownership counts stay at
    // zero until that verification exists, so Family-visible seats are never
    // misreported as independent copies.
    const launchAccounts = owners.length ? owners : accessible;
    if (!launchAccounts.length) return [];

    return [{
      id: item.app_id,
      slug: `steam-${item.app_id}`,
      name: item.name,
      app_id: item.app_id,
      credit_cost_per_hour: 0,
      copies_total: owners.length,
      copies_available: owners.length,
      availability_state: "ready",
      local_account_labels: owners.map((account) => account.account_name || account.label),
      local_access_labels: accessible.map((account) => account.account_name || account.label),
      local_primary_account_label: launchAccounts[0].account_name || launchAccounts[0].label,
      local_owner_steam_ids: owners.map((account) => account.steam_id64).filter((value): value is string => Boolean(value)),
      local_inventory_verified: pool.verification_complete,
      local_inventory_verified_at: pool.verified_at,
      ...steamAssets(item.app_id),
    }];
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
