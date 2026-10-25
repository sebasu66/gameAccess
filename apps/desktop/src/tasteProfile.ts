/**
 * What the player likes, learned from the thumbs (gameaccess:preferences: 1 likes, -1 dislikes; no rating = neutral).
 * A game is a mix of traits (genres, Steam tags, categories, developers), and a like says only that something in it
 * is liked, not that everything else is not. So the profile keeps only clear patterns:
 * - a liked trait is in most liked games (at least two) and almost never in the disliked ones;
 * - a disliked trait is in most disliked games (at least two) and almost never in the liked ones.
 * Everything else says nothing. A game matching neither is neutral and keeps its place.
 *
 * Certainty is how well the profile predicts the player's own ratings: each rated game is judged by a profile built
 * from the others (leave-one-out), and the share of hits is discounted while there are few examples. From 75 %, with
 * at least MIN_EACH examples on each side, the catalog adapts (tailorCatalog). Before that, only the disliked games
 * themselves go down.
 *
 * The traits of a rated game are kept with the rating (gameaccess:taste-traits), so the profile does not depend on
 * which games happen to be loaded.
 */
import type { CatalogGame, SteamMetadata } from "./types";
import type { TranslationKey, TranslationParams } from "./i18n";
import type { CatalogQueryParams } from "./catalogCache";

export const MIN_EACH = 3;
/** Certainty needed before the order adapts (0..1). */
export const READY_CERTAINTY = 0.75;
/** A trait is characteristic of a side when at least this share of its games has it... */
const CHARACTERISTIC = 0.5;
/** ...and at most this share of the other side's games. */
const RARE = 0.2;
/** A game leans to a side when its traits add up to at least this. */
const LEAN = 0.5;
const TRAITS_KEY = "gameaccess:taste-traits";
const MAX_TAGS = 10;

export type Ratings = Record<number, 1 | -1>;
export interface TasteTrait { key: string; label: string; weight: number }
export interface TasteProfile {
  likes: number;
  dislikes: number;
  /** 0..1: how well the profile predicts the player's own ratings, discounted while there are few examples. */
  certainty: number;
  ready: boolean;
  /** Clear traits, strongest first; positive weight = liked, negative = disliked. */
  traits: TasteTrait[];
}

const norm = (value: string) => value.trim().toLowerCase();

/** The traits that describe a game, as "kind:value" keys. */
export function gameTraits(game: Pick<CatalogGame, "genres" | "tags" | "categories" | "developers"> & { steam?: SteamMetadata | null }): string[] {
  const keys = new Set<string>();
  const add = (kind: string, values?: string[] | null) => { for (const value of values ?? []) if (value?.trim()) keys.add(`${kind}:${norm(value)}`); };
  add("genre", [...(game.genres ?? []), ...(game.steam?.genres ?? [])]);
  add("tag", (game.tags ?? []).slice(0, MAX_TAGS));
  add("category", [...(game.categories ?? []), ...(game.steam?.categories ?? [])]);
  add("developer", [...(game.developers ?? []), ...(game.steam?.developers ?? [])]);
  return [...keys];
}

function loadTraits(): Record<number, string[]> {
  try { return JSON.parse(localStorage.getItem(TRAITS_KEY) || "{}") as Record<number, string[]>; } catch { return {}; }
}

/** Keeps the traits of a game the player rated (call it before saving the rating). */
export function rememberTasteGame(game: (CatalogGame & { steam?: SteamMetadata | null }) | null | undefined): void {
  if (!game) return;
  const traits = gameTraits(game);
  if (!traits.length) return;
  const saved = loadTraits();
  saved[game.id] = traits;
  try { localStorage.setItem(TRAITS_KEY, JSON.stringify(saved)); } catch { /* the profile then uses loaded games */ }
}

function patterns(liked: string[][], disliked: string[][]): TasteTrait[] {
  const count = (side: string[][]) => {
    const counts = new Map<string, number>();
    for (const traits of side) for (const key of traits) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };
  const likedCounts = count(liked), dislikedCounts = count(disliked);
  const traits: TasteTrait[] = [];
  for (const key of new Set([...likedCounts.keys(), ...dislikedCounts.keys()])) {
    const inLikes = likedCounts.get(key) ?? 0, inDislikes = dislikedCounts.get(key) ?? 0;
    const likeShare = liked.length ? inLikes / liked.length : 0, dislikeShare = disliked.length ? inDislikes / disliked.length : 0;
    const label = key.slice(key.indexOf(":") + 1);
    if (inLikes >= 2 && likeShare >= CHARACTERISTIC && dislikeShare <= RARE) traits.push({ key, label, weight: likeShare - dislikeShare });
    else if (inDislikes >= 2 && dislikeShare >= CHARACTERISTIC && likeShare <= RARE) traits.push({ key, label, weight: likeShare - dislikeShare });
  }
  return traits.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.key.localeCompare(b.key));
}

const scoreOf = (traits: TasteTrait[], own: Set<string>) => traits.reduce((score, trait) => own.has(trait.key) ? score + trait.weight : score, 0);

/** Builds the profile from the ratings; traits come from the saved ones, else from `known` games. */
export function buildTasteProfile(ratings: Ratings, known: CatalogGame[] = [], saved: Record<number, string[]> = loadTraits()): TasteProfile {
  const byId = new Map(known.map(game => [game.id, game]));
  const traitsOf = (id: number) => saved[id] ?? (byId.has(id) ? gameTraits(byId.get(id)!) : []);
  const rated: Array<{ value: 1 | -1; traits: string[] }> = [];
  for (const [id, value] of Object.entries(ratings)) {
    const traits = traitsOf(Number(id));
    if (traits.length && (value === 1 || value === -1)) rated.push({ value, traits });
  }
  const side = (items: typeof rated, value: 1 | -1) => items.filter(item => item.value === value).map(item => item.traits);
  const traits = patterns(side(rated, 1), side(rated, -1));
  const likes = rated.filter(item => item.value === 1).length, dislikes = rated.length - likes;
  let hits = 0;
  if (likes && dislikes) {
    rated.forEach((item, index) => {
      const others = rated.filter((_, other) => other !== index);
      const score = scoreOf(patterns(side(others, 1), side(others, -1)), new Set(item.traits));
      if (item.value === 1 ? score >= LEAN : score <= -LEAN) hits++;
    });
  }
  const certainty = rated.length ? hits / rated.length * rated.length / (rated.length + 2) : 0;
  const ready = likes >= MIN_EACH && dislikes >= MIN_EACH && certainty >= READY_CERTAINTY;
  return { likes, dislikes, certainty, ready, traits };
}

/** How much a game leans to the likes (> 0) or the dislikes (< 0); 0 when it matches no clear pattern. */
export function tasteScore(profile: TasteProfile, game: CatalogGame): number {
  return profile.traits.length ? scoreOf(profile.traits, new Set(gameTraits(game))) : 0;
}

/** Above this chance a game belongs to the player's top (it moves up in the scroll, after the screen). */
export const LIKELY = 0.6;
/** A game on screen gives its place only to one at least this likely... */
export const STRONG = 0.7;
/** ...and clearly more likely than itself. */
const CLEAR_GAIN = 0.15;
/** At or below this chance a game leans to the dislikes. */
const UNLIKELY = 0.35;
/** Below this chance a game is left out of the tailored results (disliked games are 0). */
export const HIDDEN_BELOW = 0.2;

/**
 * Chance (0..1) that the player likes a game: 0.5 is neutral (no clear pattern, or a profile not ready yet). It moves
 * toward 1 or 0 with the game's traits, as far as the profile's certainty allows. Disliked games are 0; liked ones
 * never fall below neutral.
 */
export function likeChance(profile: TasteProfile, game: CatalogGame, ratings: Ratings): number {
  if (ratings[game.id] === -1) return 0;
  const chance = profile.ready ? 0.5 + 0.5 * profile.certainty * Math.tanh(tasteScore(profile, game)) : 0.5;
  return ratings[game.id] === 1 ? Math.max(0.5, chance) : chance;
}

/**
 * The second catalog query, for the player's top: the same search and filters as the screen, but only genres the
 * player likes (within the player's own genre filter, if any) and none of the disliked ones. Null without a ready
 * profile or without liked genres. `genreNames` gives the database spelling of each genre.
 */
export function tasteQuery(profile: TasteProfile, base: CatalogQueryParams, genreNames: readonly string[]): CatalogQueryParams | null {
  if (!profile.ready) return null;
  const spelling = new Map(genreNames.map(name => [name.trim().toLowerCase(), name]));
  const genres = (weight: (value: number) => boolean) => [...new Set(profile.traits
    .filter(trait => trait.key.startsWith("genre:") && weight(trait.weight))
    .map(trait => spelling.get(trait.label) ?? trait.label))];
  const liked = genres(value => value > 0), disliked = genres(value => value < 0);
  if (!liked.length) return null;
  const own = base.genres ?? [];
  const wanted = own.length ? own.filter(name => liked.some(like => like.toLowerCase() === name.toLowerCase())) : liked;
  if (!wanted.length) return null;
  return { ...base, genres: wanted, exclude_genres: [...new Set([...(base.exclude_genres ?? []), ...disliked])], offset: 0, limit: 300 };
}

/**
 * The catalog order, tailored while browsing.
 * - `screen`, the games the player is looking at (in the order shown), keep their places. A disliked game, or one that
 *   leans to the dislikes, gives its place to the best of the rest; a neutral one gives it only to a game much more
 *   likely to please (STRONG and CLEAR_GAIN), and then moves to its rank below instead of to the end.
 * - Below the screen: the player's top (LIKELY and up, most likely first), then the neutral games in their usual
 *   order, then the ones that lean to the dislikes.
 * - Games the player is not likely to like (below HIDDEN_BELOW, disliked ones included) are left out.
 * `candidates` are extra games from the taste query; they join only where they rank.
 */
export function tailorCatalog(games: CatalogGame[], ratings: Ratings, profile: TasteProfile, options: { screen?: CatalogGame[]; candidates?: CatalogGame[] } = {}): CatalogGame[] {
  const ids = new Set(games.map(game => game.id));
  const every = [...games, ...(options.candidates ?? []).filter(game => !ids.has(game.id) && (ids.add(game.id), true))];
  const chance = new Map(every.map(game => [game.id, likeChance(profile, game, ratings)]));
  const all = every.filter(game => chance.get(game.id)! >= HIDDEN_BELOW);
  const order = new Map(all.map((game, index) => [game.id, index]));
  // Neutral games keep the usual order among themselves: only clear chances rank.
  const rank = (game: CatalogGame) => { const value = chance.get(game.id)!; return value >= LIKELY || value <= UNLIKELY ? value : 0.5; };
  const byRank = (a: CatalogGame, b: CatalogGame) => rank(b) - rank(a) || order.get(a.id)! - order.get(b.id)!;
  const byId = new Map(all.map(game => [game.id, game]));
  const screen = (options.screen ?? []).map(game => byId.get(game.id)).filter((game): game is CatalogGame => Boolean(game));
  const onScreen = new Set(screen.map(game => game.id));
  const pool = all.filter(game => !onScreen.has(game.id)).sort(byRank);
  const insert = (game: CatalogGame) => {
    const at = pool.findIndex(other => byRank(game, other) < 0);
    pool.splice(at < 0 ? pool.length : at, 0, game);
  };
  const head: CatalogGame[] = [];
  for (const game of screen) {
    const own = chance.get(game.id)!;
    const best = pool[0];
    if (own <= UNLIKELY) {
      if (best && chance.get(best.id)! > own) { head.push(pool.shift()!); insert(game); } else head.push(game);
    } else if (own < LIKELY && best && chance.get(best.id)! >= STRONG && chance.get(best.id)! - own >= CLEAR_GAIN) {
      head.push(pool.shift()!);
      insert(game);
    } else head.push(game);
  }
  return [...head, ...pool];
}

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

/** After a thumb: how far the profile is built, and what that means for the personalized order. */
export function tasteProgressText(before: TasteProfile, after: TasteProfile, personalOn: boolean, t: Translate): string {
  const percent = Math.round(after.certainty * 100);
  if (!after.ready) return t("tasteProgress", { percent });
  if (!before.ready) return t("tasteUnlocked", { percent });
  return personalOn ? t("tasteReady", { percent }) : t("tasteReadyOff", { percent });
}
