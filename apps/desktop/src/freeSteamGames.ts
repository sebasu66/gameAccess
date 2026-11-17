import { genreConceptIds } from "./libraryGenres";
import type { CatalogGame } from "./types";

/**
 * Which catalog games Steam gives away, so Game Access can bring them with DepotDownloader into the player's Steam
 * library (apps/launcher/steam_depot): free to play games (the esports ones), free demos, and games a Steam giveaway
 * makes free to keep right now. A free weekend lets the game be played, not kept: it is news, not a download.
 */
export type SteamFreeKind = "free_to_play" | "demo" | "free_to_keep" | "free_weekend";

export const STEAM_DEPOT_PREFIX = "steam-depot:";

const promoActive = (promo: CatalogGame["steam_free_promo"], now: number) => {
  if (!promo) return false;
  const starts = promo.starts_at ? Date.parse(promo.starts_at) : NaN;
  const ends = promo.ends_at ? Date.parse(promo.ends_at) : NaN;
  return !(starts > now) && !(ends <= now);
};

export function steamFreeKind(game: Pick<CatalogGame, "app_id" | "genres" | "tags" | "is_free" | "product_type" | "steam_free_promo">, now = Date.now()): SteamFreeKind | null {
  if (!game.app_id) return null;
  const promo = game.steam_free_promo;
  if (promo && promoActive(promo, now)) return promo.kind === "free_weekend" ? "free_weekend" : "free_to_keep";
  if (String(game.product_type ?? "").toLowerCase() === "demo") return "demo";
  if (game.is_free) return "free_to_play";
  const concepts = genreConceptIds([...(game.genres ?? []), ...(game.tags ?? [])]);
  return concepts.includes("free_to_play") ? "free_to_play" : null;
}

/** The download source the queue hands to DepotDownloader, or null when Steam does not give the game to keep. */
export function freeSteamSource(game: Parameters<typeof steamFreeKind>[0], now = Date.now()): string | null {
  const kind = steamFreeKind(game, now);
  return kind && kind !== "free_weekend" ? `${STEAM_DEPOT_PREFIX}${game.app_id}` : null;
}


/** Giveaways and free weekends not seen yet: `known` is the app ids already told (kept between runs). */
export function unseenGiveaways(catalog: readonly CatalogGame[], known: ReadonlySet<number>, now = Date.now()): CatalogGame[] {
  return catalog.filter(game => {
    const kind = steamFreeKind(game, now);
    return (kind === "free_to_keep" || kind === "free_weekend") && game.app_id != null && !known.has(game.app_id);
  });
}

const SEEN_KEY = "gameaccess:free-steam-seen";

/**
 * The "became free" watcher: each catalog load, the giveaways that were not there before are told together. The first
 * look only remembers what is free already (the section shows those), so opening the app does not greet with old news.
 */
export function watchGiveaways(catalog: readonly CatalogGame[], tell: (games: CatalogGame[]) => void, now = Date.now(),
  store: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): void {
  if (!catalog.length || !store) return;
  let known: number[] | null = null;
  try { const raw = store.getItem(SEEN_KEY); known = raw ? JSON.parse(raw) as number[] : null; } catch { known = null; }
  const fresh = unseenGiveaways(catalog, new Set(known ?? []), now);
  if (!fresh.length && known) return;
  try { store.setItem(SEEN_KEY, JSON.stringify([...new Set([...(known ?? []), ...fresh.map(game => game.app_id as number)])].slice(-500))); } catch { /* the next look tells it again */ }
  if (known && fresh.length) tell(fresh);
}
