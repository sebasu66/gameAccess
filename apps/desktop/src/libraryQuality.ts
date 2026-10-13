/**
 * Catalog quality and content screens.
 *
 * Two jobs that both answer "should this game be hidden?" without looking at what
 * the user searched for:
 *
 *  - Quality: the score and release-year bounds the user sets with the sliders.
 *    These are explicit bounds, not an age heuristic: an unknown score is not
 *    "good enough" and an unknown date is not "recent".
 *  - Content: adult and violence classification, which comes from Valve's
 *    official content descriptors and never from community tags.
 */
import type { CatalogGame } from "./types";
import type { LibrarySearchFilters } from "./librarySearch";

/**
 * Release dates arrive in several shapes: ISO (`2009-05-14`, the common one by
 * far), a Spanish label (`12 AGO 2016`, `1 de abril de 2024`) and an English one
 * (`12 Aug, 2026`, `Aug 12, 2026`). Reading only one of them silently mis-dates
 * a large part of the catalog, so all of them are accepted here, and this is the
 * ONLY date parser: sorting (`releaseDateValue`) and the year filter both call it,
 * so a game can never be "recent" for one and "unknown" for the other.
 *
 * Months are matched by their first three letters after removing accents, which
 * covers abbreviations and full names in Spanish, English and Portuguese
 * (`sep`/`sept`/`septiembre`, `ago`/`agosto`, `dic`/`dec`).
 */
const LOCALIZED_MONTHS: Record<string, number> = {
  ene: 1, jan: 1,
  feb: 2, fev: 2,
  mar: 3,
  abr: 4, apr: 4,
  may: 5, mai: 5,
  jun: 6,
  jul: 7,
  ago: 8, aug: 8,
  sep: 9, set: 9,
  oct: 10, out: 10,
  nov: 11,
  dic: 12, dec: 12, dez: 12,
};

/** A real calendar date, or null. `31 FEB` must not roll over into March. */
function calendarDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function monthNumber(word: string | undefined): number | null {
  if (!word || !/^\p{L}{3,}\.?$/u.test(word)) return null;
  return LOCALIZED_MONTHS[word.slice(0, 3)] ?? null;
}

export function parseReleaseDate(value?: string | null): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const words = raw
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/,/g, " ").split(/\s+/)
    // "1 de abril de 2024": the connector carries no information.
    .filter(word => word && word !== "de" && word !== "del");
  if (words.length !== 3) return null;
  // "12 AGO 2016" / "12 Aug, 2026": day, month, year.
  const dayFirst = monthNumber(words[1]);
  if (dayFirst !== null && /^\d{1,2}$/.test(words[0]) && /^\d{4}$/.test(words[2])) {
    return calendarDate(Number(words[2]), dayFirst, Number(words[0]));
  }
  // "Aug 12, 2026": month, day, year.
  const monthFirst = monthNumber(words[0]);
  if (monthFirst !== null && /^\d{1,2}$/.test(words[1]) && /^\d{4}$/.test(words[2])) {
    return calendarDate(Number(words[2]), monthFirst, Number(words[1]));
  }
  // "Por confirmarse", "To be announced", "Q1 2027" and friends are unknown,
  // not old: an unreadable date must never be treated as a stale release.
  return null;
}

/**
 * Community tags that mention sexual content. Kept for search enrichment only.
 *
 * Measured against Valve's descriptors these are unreliable in both directions:
 * they label Mortal Kombat 11 "Sexual Content" although Valve lists no sexual
 * descriptor for it, and they label `Blender` and `5D Chess With Multiverse Time
 * Travel` "Nudity" with no descriptor at all. They are never a filter and never
 * decide adult content.
 */
export const ADULT_CONTENT_TAGS = [
  "hentai",
  "sexual content",
  "nudity",
  "adult only",
] as const;

/** Violence/gore tags: a legitimate but different policy choice, never implied. */
export const VIOLENCE_CONTENT_TAGS = [
  "gore",
  "violent",
  "mature",
] as const;

/** Valve's content descriptor ids, confirmed against known titles. */
export const ADULT_ONLY_DESCRIPTOR_IDS: readonly number[] = [3, 4];
export const NUDITY_DESCRIPTOR_IDS: readonly number[] = [1];
export const VIOLENCE_DESCRIPTOR_IDS: readonly number[] = [2];

/**
 * Adult content comes from Valve's official descriptors, which the server
 * resolves during discovery and ships inside the catalog. Community tags are
 * deliberately not consulted here: they cause false positives on mainstream
 * titles, and a parental filter that hides Mortal Kombat 11 as "adult" is wrong.
 *
 * `includeNudity` additionally blocks descriptor 1 ("some nudity or sexual
 * content"), which is how South Park is marked. That is a policy choice rather
 * than a default.
 */
export function gameIsAdult(game: CatalogGame, includeNudity = false): boolean {
  return adultReason(game, includeNudity) !== null;
}

/** Which signal flagged the game, for diagnostics and the hidden notice. */
export function adultReason(game: CatalogGame, includeNudity = false): string | null {
  // The server's verdict from Valve's descriptors is authoritative.
  if (game.adult_only === true) return "descriptor:adult-only";
  const descriptors = game.content_descriptorids ?? [];
  const adult = descriptors.find(id => ADULT_ONLY_DESCRIPTOR_IDS.includes(id));
  if (adult !== undefined) return `descriptor:${adult}`;
  if (includeNudity) {
    const nudity = descriptors.find(id => NUDITY_DESCRIPTOR_IDS.includes(id));
    if (nudity !== undefined) return `descriptor:${nudity}`;
  }
  // Steam's own age gate, available once the detail payload has been cached.
  const age = typeof game.required_age === "string" ? Number.parseInt(game.required_age, 10) : game.required_age;
  if (typeof age === "number" && Number.isFinite(age) && age >= 18) return `required_age=${age}`;
  // Community tags never decide adult content. They are search metadata now.
  return null;
}

/** Descriptor 2, "frequent violence or gore". Reported separately from adult. */
export function gameHasViolenceDescriptor(game: CatalogGame): boolean {
  return (game.content_descriptorids ?? []).some(id => VIOLENCE_DESCRIPTOR_IDS.includes(id));
}

/** Any active catalog-quality filter, so callers can skip the work when idle. */
export function hasQualityFilters(filters: LibrarySearchFilters): boolean {
  return Boolean(
    filters.hideAdult || filters.hideViolenceDescriptor
    || filters.minReviewScore !== undefined
    || filters.releaseYearFrom !== undefined || filters.releaseYearTo !== undefined,
  );
}

/** Release year, or null when the date cannot be read. Never guessed. */
export function releaseYear(game: CatalogGame): number | null {
  const released = parseReleaseDate(game.release_date);
  return released ? released.getUTCFullYear() : null;
}

/** Reviews a game needs before its score says anything, and how long it must have been out. */
export const MIN_REVIEWS_TO_JUDGE = 10;
export const NEW_RELEASE_DAYS = 30;

/** No score yet, too few reviews, or released in the last month. */
function isUnproven(game: CatalogGame, now: number): boolean {
  if (typeof game.steam_review_score !== "number") return true;
  const reviews = game.steam_review_count;
  if (typeof reviews !== "number" || reviews < MIN_REVIEWS_TO_JUDGE) return true;
  const released = parseReleaseDate(game.release_date);
  return released !== null && now - released.getTime() < NEW_RELEASE_DAYS * 86400000;
}

/**
 * The score and year sliders.
 *
 * Both are explicit bounds, so a game that cannot be measured against them does
 * not qualify: an unknown score is not "good enough" and an unknown date is not
 * "recent". Treating either as a pass would put silent false positives in the
 * results, which is the failure this whole filter rework exists to remove.
 */
function passesSliderBounds(game: CatalogGame, filters: LibrarySearchFilters, now: number): boolean {
  if (filters.minReviewScore !== undefined) {
    const score = game.steam_review_score;
    if (filters.spareUnprovenGames) {
      // Only a game with a real track record can be "badly reviewed": it needs a handful of
      // reviews and must have been out for a while. New and unrated games are not hidden.
      if (isUnproven(game, now)) return true;
    }
    if (typeof score !== "number" || score < filters.minReviewScore) return false;
  }
  if (filters.releaseYearFrom === undefined && filters.releaseYearTo === undefined) return true;
  const year = releaseYear(game);
  if (year === null) return false;
  if (filters.releaseYearFrom !== undefined && year < filters.releaseYearFrom) return false;
  if (filters.releaseYearTo !== undefined && year > filters.releaseYearTo) return false;
  return true;
}

/** The content screens: adult-only, optional nudity, and violence as its own policy. */
function passesContentScreens(game: CatalogGame, filters: LibrarySearchFilters): boolean {
  if (filters.hideAdult && gameIsAdult(game, filters.adultIncludesNudity)) return false;
  if (filters.hideViolenceDescriptor && gameHasViolenceDescriptor(game)) return false;
  return true;
}

export function gamePassesQualityFilters(game: CatalogGame, filters: LibrarySearchFilters, now: number = Date.now()): boolean {
  return passesContentScreens(game, filters) && passesSliderBounds(game, filters, now);
}
