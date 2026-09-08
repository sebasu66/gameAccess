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
    // Defense in depth: app_ids alone is never enough. The native scanner must
    // also explicitly say that this account was verified from licenses_print.
    const owners = accounts
      .filter((account) => account.ownership_verified === true && account.app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));
    const accessible = accounts
      .filter((account) => account.accessible_app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));

    if (!owners.length && !accessible.length) return [];

    const ownerLabels = owners.map((account) => account.account_name || account.label);
    const accessLabels = accessible.map((account) => account.account_name || account.label);
    const ownerText = ownerLabels.length ? ownerLabels.join(", ") : "none";
    const accessText = accessLabels.length ? accessLabels.join(", ") : "none";
    const decision = owners.length
      ? `AVAILABLE locally because licenses_print verification confirms at least one owner (${ownerText}).`
      : "NOT AVAILABLE to play locally because no remembered account has verified ownership for this AppID.";
    decisions.push(
      `${item.name} (Steam AppID ${item.app_id}). Steam-visible/access accounts from accessible_app_ids: ${accessText}. Verified owners from licenses_print-backed app_ids: ${ownerText}. Rule applied: visibility and local ticket history never grant play; an account must have ownership_verified=true and contain the AppID in app_ids. Decision: ${decision}`,
    );

    const relevantAccounts = owners.length ? owners : accessible;
    const gameOwnershipVerified = relevantAccounts.length > 0 && relevantAccounts.every((account) => account.ownership_verified === true);

    return [{
      id: item.app_id,
      slug: `steam-${item.app_id}`,
      name: item.name,
      app_id: item.app_id,
      credit_cost_per_hour: 0,
      copies_total: owners.length,
      copies_available: owners.length,
      availability_state: owners.length ? "ready" : "unavailable",
      local_account_labels: ownerLabels,
      local_access_labels: accessLabels,
      local_primary_account_label: owners[0]?.account_name || owners[0]?.label,
      local_owner_steam_ids: owners.map((account) => account.steam_id64).filter((value): value is string => Boolean(value)),
      local_inventory_verified: gameOwnershipVerified,
      local_inventory_verified_at: pool.verified_at,
      ...steamAssets(item.app_id),
    }];
  });

  void narrateBatch(decisions, { area: "AVAILABILITY" });
  return catalog;
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
