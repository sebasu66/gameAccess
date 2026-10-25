/**
 * What the player likes, learned from the thumbs (gameaccess:preferences: 1 likes, -1 dislikes). Each rated game is
 * described by its traits (genres, Steam tags, categories, developers); a trait counts as part of the player's taste
 * when it shows up clearly more in one side than in the other (in most liked games and few disliked ones, or the
 * reverse). Once there are at least MIN_EACH examples on each side and the clearest trait is certain enough, the
 * profile is ready: the catalog sinks games that look like the dislikes and fills the holes with ones that look like
 * the likes (tailorCatalog). Before that, only the disliked games themselves go down.
 *
 * The traits of a rated game are kept with the rating (gameaccess:taste-traits), so the profile does not depend on
 * which games happen to be loaded.
 */
import type { CatalogGame, SteamMetadata } from "./types";
import type { TranslationKey, TranslationParams } from "./i18n";

export const MIN_EACH = 3;
/** Certainty needed before the order adapts (0..1). */
export const READY_CERTAINTY = 0.6;
/** A trait must split the two sides at least this much (share in likes minus share in dislikes). */
const SPLIT = 0.5;
const TRAITS_KEY = "gameaccess:taste-traits";
const MAX_TAGS = 10;

export type Ratings = Record<number, 1 | -1>;
export interface TasteTrait { key: string; label: string; weight: number }
export interface TasteProfile {
  likes: number;
  dislikes: number;
  /** 0..1: how clearly the best trait separates likes from dislikes, discounted while there are few examples. */
  certainty: number;
  ready: boolean;
  /** Traits of the taste, strongest first; positive weight = liked, negative = disliked. */
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

/** Builds the profile from the ratings; traits come from the saved ones, else from `known` games. */
export function buildTasteProfile(ratings: Ratings, known: CatalogGame[] = [], saved: Record<number, string[]> = loadTraits()): TasteProfile {
  const byId = new Map(known.map(game => [game.id, game]));
  const traitsOf = (id: number) => saved[id] ?? (byId.has(id) ? gameTraits(byId.get(id)!) : []);
  const liked: string[][] = [], disliked: string[][] = [];
  for (const [id, value] of Object.entries(ratings)) {
    const traits = traitsOf(Number(id));
    if (!traits.length) continue;
    (value === 1 ? liked : value === -1 ? disliked : []).push(traits);
  }
  const count = (side: string[][]) => {
    const counts = new Map<string, number>();
    for (const traits of side) for (const key of traits) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };
  const likedCounts = count(liked), dislikedCounts = count(disliked);
  const traits: TasteTrait[] = [];
  for (const key of new Set([...likedCounts.keys(), ...dislikedCounts.keys()])) {
    const inLikes = likedCounts.get(key) ?? 0, inDislikes = dislikedCounts.get(key) ?? 0;
    if (inLikes + inDislikes < 2) continue;
    const weight = (liked.length ? inLikes / liked.length : 0) - (disliked.length ? inDislikes / disliked.length : 0);
    if (Math.abs(weight) >= SPLIT) traits.push({ key, label: key.slice(key.indexOf(":") + 1), weight });
  }
  traits.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.key.localeCompare(b.key));
  const fewest = Math.min(liked.length, disliked.length);
  const certainty = traits.length ? Math.abs(traits[0].weight) * fewest / (fewest + 1) : 0;
  const ready = liked.length >= MIN_EACH && disliked.length >= MIN_EACH && certainty >= READY_CERTAINTY;
  return { likes: liked.length, dislikes: disliked.length, certainty, ready, traits };
}

/** How much a game looks like the likes (> 0) or the dislikes (< 0). */
export function tasteScore(profile: TasteProfile, game: CatalogGame): number {
  if (!profile.traits.length) return 0;
  const own = new Set(gameTraits(game));
  return profile.traits.reduce((score, trait) => own.has(trait.key) ? score + trait.weight : score, 0);
}

/**
 * The catalog order, tailored while browsing. Disliked games always go to the end. With a ready profile, games
 * that look like the dislikes go to the end too, and each place they leave is taken by the best match for the likes
 * from further down the list, so the games on screen stay where they were and only the holes change.
 */
export function tailorCatalog(games: CatalogGame[], ratings: Ratings, profile: TasteProfile): CatalogGame[] {
  const score = new Map<number, number>();
  if (profile.ready) for (const game of games) score.set(game.id, tasteScore(profile, game));
  const sinks = (game: CatalogGame) => ratings[game.id] === -1 || (score.get(game.id) ?? 0) < 0;
  if (!games.some(sinks)) return games;
  const picks = games.filter(game => !sinks(game) && ratings[game.id] !== 1 && (score.get(game.id) ?? 0) > 0)
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

/** What the player reads after a thumb: how far the profile is from adapting the list, or what it learned. */
export function tasteProgressText(before: TasteProfile, after: TasteProfile, t: Translate): string {
  if (!after.ready) {
    if (after.likes < MIN_EACH || after.dislikes < MIN_EACH) return t("tasteNeedMore", { likes: Math.min(after.likes, MIN_EACH), dislikes: Math.min(after.dislikes, MIN_EACH), min: MIN_EACH });
    return t("tasteUnclear");
  }
  if (before.ready) return t("tasteAdapting");
  // The same word can be a genre and a tag: each label once.
  const labels = (positive: boolean) => [...new Set(after.traits.filter(trait => (trait.weight > 0) === positive).map(trait => trait.label))].slice(0, 2);
  const liked = labels(true), disliked = labels(false);
  return liked.length ? t("tasteReadyLikes", { traits: liked.join(", ") }) : t("tasteReadyDislikes", { traits: disliked.join(", ") });
}
