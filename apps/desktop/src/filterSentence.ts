import { CONTENT_FILTER_GROUPS, MULTIPLAYER_OPTION_KEYS, featureLabel, type LibrarySearchFilters } from "./librarySearch";
import { genreLabel } from "./libraryGenres";

/** One piece of the sentence. `hl` marks a value the user chose, shown highlighted. */
export type SentencePart = { text: string; hl?: boolean };

/** Year bounds shared with the release-date slider. */
export const EARLIEST_YEAR = 1995;
export const latestYear = () => new Date().getFullYear() + 1;

const plain = (text: string): SentencePart => ({ text });
const mark = (text: string): SentencePart => ({ text, hl: true });

/** "a", "a y b", "a, b y c" with each item highlighted. */
function list(items: string[], joiner = "y"): SentencePart[] {
  const parts: SentencePart[] = [];
  items.forEach((item, index) => {
    if (index > 0) parts.push(plain(index === items.length - 1 ? ` ${joiner} ` : ", "));
    parts.push(mark(item));
  });
  return parts;
}

/**
 * The filters as one readable sentence, e.g.
 * "Quiero encontrar juegos de Acción y Aventura, pero no de Terror, de un solo jugador…".
 * Only what is active appears, so an untouched panel reads as the plain default.
 */
export function buildFilterSentence(filters: LibrarySearchFilters, now = new Date().getFullYear()): SentencePart[] {
  const parts: SentencePart[] = [plain("Quiero encontrar "), mark(filters.software === true ? "programas" : "juegos")];

  const included = (filters.genres ?? []).map(genreLabel);
  const excluded = (filters.excludeGenres ?? []).map(genreLabel);
  if (included.length) parts.push(plain(" de "), ...list(included));
  if (excluded.length) parts.push(plain(included.length ? ", pero no de " : " que no sean de "), ...list(excluded, "ni"));

  const features = filters.features ?? [];
  if (features.includes("single_player")) {
    parts.push(plain(", de "), mark("un solo jugador"));
  } else if (features.includes("multiplayer") || MULTIPLAYER_OPTION_KEYS.some(key => features.includes(key))) {
    parts.push(plain(", que admitan "), mark("multijugador"));
    const modes = MULTIPLAYER_OPTION_KEYS.filter(key => features.includes(key)).map(featureLabel);
    if (modes.length) parts.push(plain(" ("), ...list(modes), plain(")"));
  }

  if (filters.minReviewScore !== undefined) {
    parts.push(plain(", con al menos "), mark(`${filters.minReviewScore} %`), plain(" de reseñas positivas"));
  }

  const from = filters.releaseYearFrom;
  const to = filters.releaseYearTo;
  const hasFrom = from !== undefined && from > EARLIEST_YEAR;
  const hasTo = to !== undefined && to < now;
  if (hasFrom && !hasTo) {
    const years = now - (from as number);
    parts.push(plain(", lanzados "), years >= 1 && years <= 5
      ? mark(years === 1 ? "en el último año" : `en los últimos ${years} años`)
      : mark(`desde ${from}`));
  } else if (hasFrom && hasTo) {
    parts.push(plain(", lanzados entre "), mark(String(from)), plain(" y "), mark(String(to)));
  } else if (hasTo) {
    parts.push(plain(", lanzados hasta "), mark(String(to)));
  }

  if (filters.contentDescriptorIds?.length) {
    const group = CONTENT_FILTER_GROUPS.find(item => item.descriptorIds.some(id => filters.contentDescriptorIds?.includes(id)));
    if (group) parts.push(plain(", con "), mark(group.label.toLowerCase()));
  }

  const sources = filters.sources ?? [];
  const noSources = filters.excludeSources ?? [];
  if (sources.length) parts.push(plain(", con fuente "), ...list(sources, "o"));
  if (noSources.length) parts.push(plain(sources.length ? " y sin " : ", sin fuente "), ...list(noSources, "ni"));

  parts.push(plain("."));
  return parts;
}

/** The sentence as plain text, for tests and screen readers. */
export function sentenceText(parts: SentencePart[]): string {
  return parts.map(part => part.text).join("");
}
