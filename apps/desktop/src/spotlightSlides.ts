/**
 * Data for the catalog banner (CatalogSpotlight): the latest games on Steam, each with a wide image that really
 * loads. It is fetched once, early, so the banner is complete (image decoded) before the catalog appears instead of
 * popping in after the view has changed.
 *
 * New games often have no `library_hero` at the usual address (Steam now stores it under a hashed path), so each
 * game tries, in order: the catalog's hero image, the hero by app id, then the Steam details (hero, page background,
 * first screenshot). Images narrower than 1000 px are skipped (they would look blurry and badly cropped), and a game
 * with no usable image is left out of the banner.
 */
import { loadDetails } from "./api";
import { queryCatalogCache } from "./catalogCache";
import type { CatalogGame } from "./types";

export interface Slide { game: CatalogGame; url: string }

const MIN_WIDTH = 1000;
const kept = new Set<HTMLImageElement>();
let slides: Slide[] | null = null;
let loading: Promise<Slide[]> | null = null;

async function usable(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (image.naturalWidth < MIN_WIDTH) return null;
    kept.add(image); // keeps the decoded image in memory, so the banner shows it at once
    return url;
  } catch { return null; }
}

async function imageFor(game: CatalogGame): Promise<string | null> {
  const byId = game.app_id ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/library_hero.jpg` : null;
  for (const candidate of [game.hero_image, byId]) {
    const found = await usable(candidate);
    if (found) return found;
  }
  try {
    const steam = (await loadDetails(game.id, game)).steam;
    for (const candidate of [steam?.hero_image, steam?.background, steam?.screenshots?.[0]?.full]) {
      const found = await usable(candidate);
      if (found) return found;
    }
  } catch { /* no details: the game is left out */ }
  return null;
}

/** The banner slides, fetched once. Safe to call many times. */
export function prefetchSpotlight(): Promise<Slide[]> {
  if (slides) return Promise.resolve(slides);
  loading ??= queryCatalogCache({ sort_by: "release-date", sort_direction: "desc", limit: 12 })
    .then(async result => {
      const found = await Promise.all(result.items.map(async game => ({ game, url: await imageFor(game) })));
      slides = found.filter((slide): slide is Slide => Boolean(slide.url));
      return slides;
    })
    .catch(() => { loading = null; return []; });
  return loading;
}

/** The slides if they are already loaded (the banner then renders complete on its first frame). */
export const cachedSpotlight = (): Slide[] | null => slides;
