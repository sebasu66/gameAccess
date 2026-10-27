/**
 * Data for the catalog banner (CatalogSpotlight): the games that came out on Steam these days (already out, released
 * in the last two weeks, a month if there are too few; the most played first), each with a wide image that really
 * loads. They come from the local catalog, which the GitHub job refreshes from Steam and the app syncs on opening and
 * every day, so every game shown has its detail page; when the catalog changes, the banner is picked again. It is fetched once, early, so the banner is complete (image decoded) before the catalog appears instead of
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
const listeners = new Set<() => void>();

/** How recent "these days" is, and the wider window when the catalog has too few new games with an image. */
const NEW_DAYS = 14, NEW_DAYS_FALLBACK = 30, ENOUGH = 3;

const newGames = (days: number) => queryCatalogCache({ released_only: true, max_age_days: days, sort_by: "popularity", limit: 12 });

async function withImages(games: CatalogGame[]): Promise<Slide[]> {
  const found = await Promise.all(games.map(async game => ({ game, url: await imageFor(game) })));
  return found.filter((slide): slide is Slide => Boolean(slide.url));
}

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
  loading ??= newGames(NEW_DAYS)
    .then(async result => {
      let found = await withImages(result.items);
      if (found.length < ENOUGH) {
        const seen = new Set(found.map(slide => slide.game.id));
        found = [...found, ...await withImages((await newGames(NEW_DAYS_FALLBACK)).items.filter(game => !seen.has(game.id)))];
      }
      slides = found;
      return slides;
    })
    .catch(() => { loading = null; return []; });
  return loading;
}

/** The catalog changed (new games from Steam): the banner is picked again, and the open one follows. */
export function onSpotlightChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
if (typeof window !== "undefined") window.addEventListener("gameaccess:catalog-data-changed", () => {
  slides = null;
  loading = null;
  void prefetchSpotlight().then(() => { for (const listener of listeners) listener(); });
});

/** The slides if they are already loaded (the banner then renders complete on its first frame). */
export const cachedSpotlight = (): Slide[] | null => slides;
