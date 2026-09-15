import type { CatalogGame } from "./types";

export function isPortraitArtwork(width: number, height: number): boolean {
  return width > 0 && height > 0 && width / height >= 0.55 && width / height <= 0.8;
}

export function libraryArtworkCandidates(game: CatalogGame) {
  const appId = game.app_id;
  const candidates = [
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg` : null,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg` : null,
    appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg` : null,
    game.capsule_image,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}
