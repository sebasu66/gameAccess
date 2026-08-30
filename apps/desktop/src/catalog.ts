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
    const accessible = accounts.filter((account) => account.accessible_app_ids.includes(item.app_id));
    // A Family-visible game without a mapped original owner cannot be launched
    // deterministically, so it must not enter the playable local catalog.
    if (!owners.length) return [];
    return [{
      id: item.app_id,
      slug: `steam-${item.app_id}`,
      name: item.name,
      app_id: item.app_id,
      credit_cost_per_hour: 0,
      copies_total: owners.length,
      // Family access does not create another simultaneous license. One owner
      // account is one independently launchable copy.
      copies_available: owners.length,
      availability_state: "ready",
      local_account_labels: owners.map((account) => account.account_name || account.label),
      local_access_labels: accessible.map((account) => account.account_name || account.label),
      local_primary_account_label: owners[0].account_name || owners[0].label,
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
    const localGame = game.app_id ? byApp.get(game.app_id) : undefined;
    if (localGame) {
      byApp.set(game.app_id!, {
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
    } else if (game.app_id) byApp.set(game.app_id, game);
  }
  return [...byApp.values(), ...remote.filter((game) => !game.app_id)];
}
