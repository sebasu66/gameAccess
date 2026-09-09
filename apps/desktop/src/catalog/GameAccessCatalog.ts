import type { CatalogGame } from "../types";

export type GameAccessCatalogLoader = () => Promise<CatalogGame[]>;

/**
 * Loads the GameAccess tab only.
 *
 * Contract:
 * - The backend is the only license/catalog authority for this tab.
 * - Personal/local Steam ownership fields are stripped even if a malformed
 *   backend response ever contains them.
 * - A matching Steam AppID in Propios is a separate license route and is never
 *   merged into this catalog.
 */
export class GameAccessCatalog {
  constructor(private readonly loadBackendCatalog: GameAccessCatalogLoader) {}

  async load(): Promise<CatalogGame[]> {
    const games = await this.loadBackendCatalog();
    return games.map((game) => {
      const {
        local_account_labels: _localAccountLabels,
        local_access_labels: _localAccessLabels,
        local_primary_account_label: _localPrimaryAccountLabel,
        local_owner_steam_ids: _localOwnerSteamIds,
        local_inventory_verified: _localInventoryVerified,
        local_inventory_verified_at: _localInventoryVerifiedAt,
        ...backendGame
      } = game;
      return backendGame;
    });
  }
}
