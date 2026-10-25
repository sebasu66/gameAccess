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

/**
 * The catalog order, tailored while browsing. Disliked games always go to the end. With a ready profile, games
 * that clearly lean to the dislikes go to the end too, and each place they leave is taken by the best match for the
 * likes from further down the list; neutral games stay where they were, so only the holes change.
 */
export function tailorCatalog(games: CatalogGame[], ratings: Ratings, profile: TasteProfile): CatalogGame[] {
  const score = new Map<number, number>();
  if (profile.ready) for (const game of games) score.set(game.id, tasteScore(profile, game));
  const sinks = (game: CatalogGame) => ratings[game.id] === -1 || (score.get(game.id) ?? 0) <= -LEAN;
  if (!games.some(sinks)) return games;
  const picks = games.filter(game => !sinks(game) && ratings[game.id] !== 1 && (score.get(game.id) ?? 0) >= LEAN)
    .sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
  const placed = new Set<number>();
  const out: CatalogGame[] = [];
  let next = 0;
  for (const game of games) {
    if (sinks(game)) {
      while (next < picks.length && placed.has(picks[next].id)) next++;
      if (next < picks.length) { out.push(picks[next]); placed.add(picks[next].id); next++; }
    } else if (!placed.has(game.id)) { out.push(game); placed.add(game.id); }
  }
  for (const game of games) if (!sinks(game) && !placed.has(game.id)) out.push(game);
  // Then what only looks like the dislikes (the least alike first), and the disliked games themselves last.
  const alike = games.filter(game => sinks(game) && ratings[game.id] !== -1).sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
  return [...out, ...alike, ...games.filter(game => ratings[game.id] === -1)];
}

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

/** After a thumb: how far the profile is built, and whether the results adapt yet. */
export function tasteProgressText(profile: TasteProfile, t: Translate): string {
  const percent = Math.round(profile.certainty * 100);
  return profile.ready ? t("tasteReady", { percent }) : t("tasteProgress", { percent });
}
