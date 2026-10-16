import { MULTIPLAYER_OPTION_KEYS, type LibraryFeatureKey, type LibrarySearchFilters } from "./librarySearch";
import { genreLabel } from "./libraryGenres";
import { releaseWords } from "./releaseScale";

/** Which editor a clickable term opens. */
export type SentenceSlot = "genres" | "players" | "score" | "date";

/** One piece of the sentence. A part with a `slot` is a term the user can click to change. */
export type SentencePart = { text: string; slot?: SentenceSlot };

/** The sentence is two lines: what to look for, then how well reviewed and how recent. */
export type FilterSentence = [SentencePart[], SentencePart[]];

/** Year bounds shared with the release-date editor. */
export const EARLIEST_YEAR = 1995;
export const latestYear = () => new Date().getFullYear() + 1;

/** How each multiplayer option reads inside a sentence. */
export const PLAYER_MODE_WORDS: Partial<Record<LibraryFeatureKey, string>> = {
  coop: "cooperativo", pvp: "PvP", mmo: "MMO", shared_split_screen: "misma pantalla", lan: "LAN", online_multiplayer: "online",
};

/** How many genres the sentence names before it says "varios géneros". */
export const MAX_NAMED_GENRES = 3;

const plain = (text: string): SentencePart => ({ text });
const term = (text: string, slot: SentenceSlot): SentencePart => ({ text, slot });

/** "a", "a y b", "a, b y c" with each item a clickable term. */
function list(items: string[], slot: SentenceSlot, joiner = "y"): SentencePart[] {
  const parts: SentencePart[] = [];
  items.forEach((item, index) => {
    if (index > 0) parts.push(plain(index === items.length - 1 ? ` ${joiner} ` : ", "));
    parts.push(term(item, slot));
  });
  return parts;
}

/** The release window in words, e.g. "en el último año" or "desde 2010". */
export function dateWords(filters: LibrarySearchFilters, now = new Date().getFullYear()): string {
  const recent = releaseWords(filters.maxAgeDays);
  if (recent) return recent;
  const from = filters.releaseYearFrom;
  const to = filters.releaseYearTo;
  const hasFrom = from !== undefined && from > EARLIEST_YEAR;
  const hasTo = to !== undefined && to < now;
  if (hasFrom && !hasTo) {
    const years = now - (from as number);
    return years >= 1 && years <= 10
      ? (years === 1 ? "en el último año" : `en los últimos ${years} años`)
      : `desde ${from}`;
  }
  if (hasFrom && hasTo) return `entre ${from} y ${to}`;
  if (hasTo) return `hasta ${to}`;
  return "en cualquier fecha";
}

/**
 * The filters as a two-line sentence in plain Spanish. The terms that can change
 * carry a slot; with nothing chosen every slot reads as "cualquier…", so an
 * untouched dialog is the permissive default.
 */
export function buildFilterSentence(filters: LibrarySearchFilters, now = new Date().getFullYear()): FilterSentence {
  const line1: SentencePart[] = [plain("Quiero encontrar "), plain("juegos"), plain(" de ")];

  const included = (filters.genres ?? []).map(genreLabel);
  const excluded = (filters.excludeGenres ?? []).map(genreLabel);
  // Past a few genres the sentence would not fit, so it just says "varios".
  if (included.length > MAX_NAMED_GENRES) line1.push(term("varios géneros", "genres"));
  else if (included.length) line1.push(...list(included, "genres"));
  else line1.push(term("cualquier género", "genres"));
  if (excluded.length > MAX_NAMED_GENRES) line1.push(plain("\u2060, pero no de "), term("varios géneros", "genres"));
  else if (excluded.length) line1.push(plain("\u2060, pero no de "), ...list(excluded, "genres", "ni"));

  const features = filters.features ?? [];
  line1.push(plain("\u2060, para "));
  if (features.includes("single_player")) {
    line1.push(term("un solo jugador", "players"));
  } else if (features.includes("multiplayer") || MULTIPLAYER_OPTION_KEYS.some(key => features.includes(key))) {
    line1.push(term("multijugador", "players"));
    const modes = MULTIPLAYER_OPTION_KEYS.filter(key => features.includes(key)).map(key => PLAYER_MODE_WORDS[key] ?? key);
    if (modes.length) line1.push(plain(" ("), ...list(modes, "players"), plain("\u2060)"));
  } else {
    line1.push(term("cualquier número de jugadores", "players"));
  }
  line1.push(plain("\u2060."));

  // A review floor reads as part of the same clause, so the line keeps one rhythm.
  const floor = filters.minReviewCount;
  const line2: SentencePart[] = filters.minReviewScore !== undefined
    ? [plain("Con al menos "), term(`${filters.minReviewScore} %`, "score"), plain(`\u2060 de reseñas positivas${floor !== undefined ? ` y ${floor} reseñas como mínimo` : ""}, `)]
    : [plain("Con "), term("cualquier puntaje", "score"), plain(`\u2060 de reseñas${floor !== undefined ? `, pero con ${floor} reseñas como mínimo` : ""}, `)];
  line2.push(plain("lanzados "), term(dateWords(filters, now), "date"), plain("\u2060."));
  return [line1, line2];
}

/** The sentence as plain text, for tests and screen readers. */
export function sentenceText(sentence: FilterSentence): string {
  return sentence.map(line => line.map(part => part.text).join("")).join(" ").replaceAll("\u2060", "");
}
