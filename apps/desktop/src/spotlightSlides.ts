/**
 * Data for the catalog banner (CatalogSpotlight): the games the Steam store features now (its top sellers, specials,
 * featured games and the most played of the week, in that order; `steam_featured_app_ids`), limited to the games of
 * the GameAccess catalog, so every game shown has its detail page. The last list Steam gave is kept, so without
 * network the banner still shows those games; with no list at all (first start offline) it falls back to the games
 * that came out these days (released in the last two weeks, a month if there are too few; the most played first).
 * When the catalog changes, the banner is picked again. It is fetched once, early, so the banner is complete (image
 * decoded) before the catalog appears instead of popping in after the view has changed.
 *
 * New games often have no `library_hero` at the usual address (Steam now stores it under a hashed path), so each
 * game tries, in order: the catalog's hero image, the hero by app id, then the Steam details (hero, page background,
 * first screenshot). Images narrower than 1000 px are skipped (they would look blurry and badly cropped), and a game
 * with no usable image is left out of the banner.
 */
import { invoke } from "@tauri-apps/api/core";
import { loadDetails } from "./api";
import { queryCatalogCache } from "./catalogCache";
import { demoFeaturedAppIds, uiDemo } from "./devDemo/uiDemo";
import type { CatalogGame } from "./types";

/** `featured`: Steam features the game now; otherwise it is one of the games that came out these days. */
export interface Slide { game: CatalogGame; url: string; featured: boolean }

const MIN_WIDTH = 1000;
const kept = new Set<HTMLImageElement>();
let slides: Slide[] | null = null;
let loading: Promise<Slide[]> | null = null;
const listeners = new Set<() => void>();

/** How recent "these days" is, and the wider window when the catalog has too few new games with an image. */
const NEW_DAYS = 14, NEW_DAYS_FALLBACK = 30, ENOUGH = 3;

/** How many featured games are looked at (their images are loaded), enough for the five slides once some fall out. */
const FEATURED_GAMES = 12;
const FEATURED_KEY = "gameaccess.spotlight.featured";

const newGames = (days: number) => queryCatalogCache({ released_only: true, max_age_days: days, sort_by: "popularity", limit: 12 });

/** The catalog games in the order Steam features them (the catalog answers in its own order). */
export function inFeaturedOrder(appIds: number[], games: CatalogGame[]): CatalogGame[] {
  const rank = new Map(appIds.map((id, index) => [id, index]));
  const position = (game: CatalogGame) => rank.get(game.app_id ?? -1) ?? Number.MAX_SAFE_INTEGER;
  return games.filter(game => rank.has(game.app_id ?? -1)).sort((a, b) => position(a) - position(b));
}

/** What Steam features now; without an answer, the last list it gave (kept between sessions). */
export async function featuredAppIds(): Promise<number[]> {
  let saved: number[] = [];
  try { saved = JSON.parse(localStorage.getItem(FEATURED_KEY) ?? "[]"); } catch { /* no saved list */ }
  try {
    const ids = "__TAURI_INTERNALS__" in window ? await invoke<number[]>("steam_featured_app_ids") : import.meta.env.DEV && uiDemo() ? demoFeaturedAppIds : [];
    if (ids.length) {
      try { localStorage.setItem(FEATURED_KEY, JSON.stringify(ids)); } catch { /* kept for this session only */ }
      return ids;
    }
  } catch { /* offline or Steam did not answer */ }
  return Array.isArray(saved) ? saved.filter(id => Number.isInteger(id)) : [];
}

async function featuredGames(): Promise<CatalogGame[]> {
  const ids = await featuredAppIds();
  if (!ids.length) return [];
  // Adult games stay out even with the parental policy off: the banner is the first thing anyone sees.
  const found = await queryCatalogCache({ app_ids: ids, released_only: true, hide_adult: true, limit: ids.length });
  return inFeaturedOrder(ids, found.items).slice(0, FEATURED_GAMES);
}

async function withImages(games: CatalogGame[], featured: boolean): Promise<Slide[]> {
  const found = await Promise.all(games.map(async game => ({ game, url: await imageFor(game), featured })));
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
  loading ??= featuredGames()
    .catch(() => [])
    .then(async featured => {
      let found = await withImages(featured, true);
      for (const days of [NEW_DAYS, NEW_DAYS_FALLBACK]) {
        if (found.length >= ENOUGH) break;
        const seen = new Set(found.map(slide => slide.game.id));
        found = [...found, ...await withImages((await newGames(days)).items.filter(game => !seen.has(game.id)), false)];
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
