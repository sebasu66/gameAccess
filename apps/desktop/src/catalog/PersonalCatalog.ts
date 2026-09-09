import type { LocalSteamAccount, LocalSteamPool } from "../native";
import type { CatalogGame } from "../types";

function steamAssets(appId: number) {
  return {
    header_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    capsule_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
    hero_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
    steam_url: `https://store.steampowered.com/app/${appId}/`,
  };
}

function accountLabel(account: LocalSteamAccount): string {
  return (account.account_name || account.label || "Steam").trim();
}

function owns(account: LocalSteamAccount, appId: number): boolean {
  return account.ownership_verified === true && account.app_ids.includes(appId);
}

function canRun(account: LocalSteamAccount, appId: number): boolean {
  if (owns(account, appId)) return true;
  return account.runnable_verified === true && (account.runnable_app_ids ?? []).includes(appId);
}

function visibleTo(account: LocalSteamAccount, appId: number): boolean {
  return account.accessible_app_ids.includes(appId);
}

/**
 * Builds the Propios catalog only.
 *
 * Contract:
 * - A game belongs here only when one of the user's personal Steam accounts has
 *   a verified runnable route: direct ownership or verified Family access.
 * - localconfig/access visibility is diagnostic only and can never create a row.
 * - This class never accepts or merges GameAccess/backend licenses.
 */
export class PersonalCatalog {
  build(pool: LocalSteamPool): CatalogGame[] {
    const accounts = pool.accounts ?? [];

    return (pool.games ?? []).flatMap((game): CatalogGame[] => {
      const owners = accounts.filter((account) => owns(account, game.app_id));
      const runnable = accounts.filter((account) => canRun(account, game.app_id));
      if (!runnable.length) return [];

      const visible = accounts.filter((account) => visibleTo(account, game.app_id));
      const ownerLabels = owners.map(accountLabel);
      const runnableLabels = runnable.map(accountLabel);
      const visibleLabels = visible.map(accountLabel);
      const copiesTotal = Math.max(owners.length, 1);

      return [{
        id: game.app_id,
        slug: `steam-${game.app_id}`,
        name: game.name,
        app_id: game.app_id,
        credit_cost_per_hour: 0,
        copies_total: copiesTotal,
        copies_available: copiesTotal,
        availability_state: "ready",
        local_account_labels: runnableLabels,
        local_access_labels: visibleLabels,
        local_primary_account_label: runnableLabels[0],
        local_owner_steam_ids: owners
          .map((account) => account.steam_id64)
          .filter((value): value is string => Boolean(value)),
        local_inventory_verified: true,
        local_inventory_verified_at: pool.verified_at,
        ...steamAssets(game.app_id),
      }];
    });
  }
}
