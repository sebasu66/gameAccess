import type { CatalogGame } from "./types";

export function isPortraitArtwork(width: number, height: number): boolean {
  return width > 0 && height > 0 && width / height >= 0.55 && width / height <= 0.8;
}

/**
 * Artwork candidates for a card: only what the catalog actually provides.
 *
 * Steam serves covers from hashed paths that cannot be derived from an AppID.
 * Deriving them here produced URLs that answer 404 for most of the catalog, so
 * the server resolves the real paths once (see `catalog_artwork.py`) and this
 * only orders them. A game without a resolved cover returns an empty list and
 * the card renders its placeholder without firing requests.
 */
// The grid now asks the resolver for the right-sized portrait first (see `libraryCoverResolver.ts`), so this
// list is only the fallback. Hero and header images are landscape and can never fill a portrait card, so they
// are no longer returned, and the catalog capsule is kept only if its name marks it as a library (portrait)
// capsule: Steam's `capsule_imagev5` is a 184x69 landscape banner.
export function libraryArtworkCandidates(game: CatalogGame) {
  const capsule = game.capsule_image;
  return capsule && /library_(capsule|600x900)/.test(capsule) ? [capsule] : [];
}
