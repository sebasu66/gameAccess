import { MULTIPLAYER_OPTION_KEYS, type LibraryFeatureKey, type LibrarySearchFilters } from "./librarySearch";
import { genreLabel } from "./libraryGenres";
import { releaseWords } from "./releaseScale";
import { getAppLocale, translate, type AppLocale, type TranslationKey } from "./i18n";

/** Which editor a clickable term opens. */
export type SentenceSlot = "genres" | "players" | "score" | "date";

/** One piece of the sentence. A part with a `slot` is a term the user can click to change. */
export type SentencePart = { text: string; slot?: SentenceSlot };

/** The sentence is two lines: what to look for, then how well reviewed and how recent. */
export type FilterSentence = [SentencePart[], SentencePart[]];

/** Year bounds shared with the release-date editor. */
export const EARLIEST_YEAR = 1995;
export const latestYear = () => new Date().getFullYear() + 1;

/** How each multiplayer option reads inside a sentence (a translation key). */
export const PLAYER_MODE_WORDS: Partial<Record<LibraryFeatureKey, TranslationKey>> = {
  coop: "sentenceModeCoop", pvp: "chipPvp", mmo: "chipMmo", shared_split_screen: "sentenceModeSameScreen", lan: "chipLan", online_multiplayer: "sentenceModeOnline",
};

/** How many genres the sentence names before it says "varios géneros". */
export const MAX_NAMED_GENRES = 3;

const plain = (text: string): SentencePart => ({ text });
const term = (text: string, slot: SentenceSlot): SentencePart => ({ text, slot });

/** "a", "a y b", "a, b y c" (or "a and b") with each item a clickable term. */
function list(items: string[], slot: SentenceSlot, joiner: string): SentencePart[] {
  const parts: SentencePart[] = [];
  items.forEach((item, index) => {
    if (index > 0) parts.push(plain(index === items.length - 1 ? joiner : ", "));
    parts.push(term(item, slot));
  });
  return parts;
}

/** The release window in words, e.g. "en el último año" / "in the last year" or "desde 2010" / "since 2010". */
export function dateWords(filters: LibrarySearchFilters, now = new Date().getFullYear(), locale: AppLocale = getAppLocale()): string {
  const recent = releaseWords(filters.maxAgeDays, locale);
  if (recent) return recent;
  const from = filters.releaseYearFrom;
  const to = filters.releaseYearTo;
  const hasFrom = from !== undefined && from > EARLIEST_YEAR;
  const hasTo = to !== undefined && to < now;
  if (hasFrom && !hasTo) {
    const years = now - (from as number);
    if (years === 1) return translate("sentenceLastYear", undefined, locale);
    return years >= 2 && years <= 10
      ? translate("sentenceLastYears", { count: years }, locale)
      : translate("sentenceSince", { year: from as number }, locale);
  }
  if (hasFrom && hasTo) return translate("sentenceBetween", { from: from as number, to: to as number }, locale);
  if (hasTo) return translate("sentenceUntil", { year: to as number }, locale);
  return translate("sentenceAnyDate", undefined, locale);
}

/**
 * The filters as a two-line sentence in the app's language. The terms that can
 * change carry a slot; with nothing chosen every slot reads as "cualquier…" /
 * "any…", so an untouched dialog is the permissive default.
 */
export function buildFilterSentence(filters: LibrarySearchFilters, now = new Date().getFullYear(), locale: AppLocale = getAppLocale()): FilterSentence {
  const tr = (key: TranslationKey, params?: Record<string, string | number>) => translate(key, params, locale);
  const line1: SentencePart[] = [plain(tr("sentenceStart")), plain(tr("sentenceGames")), plain(tr("sentenceGenresLead"))];

  const included = (filters.genres ?? []).map(genreLabel);
  const excluded = (filters.excludeGenres ?? []).map(genreLabel);
  // Past a few genres the sentence would not fit, so it just says "varios".
  if (included.length > MAX_NAMED_GENRES) line1.push(term(tr("sentenceSeveralGenres"), "genres"));
  else if (included.length) line1.push(...list(included, "genres", tr("sentenceAnd")));
  else line1.push(term(tr("sentenceAnyGenre"), "genres"));
  if (excluded.length > MAX_NAMED_GENRES) line1.push(plain("\u2060" + tr("sentenceExcludedLead")), term(tr("sentenceSeveralGenres"), "genres"));
  else if (excluded.length) line1.push(plain("\u2060" + tr("sentenceExcludedLead")), ...list(excluded, "genres", tr("sentenceNor")));

  const features = filters.features ?? [];
  line1.push(plain("\u2060" + tr("sentencePlayersLead")));
  if (features.includes("single_player")) {
    line1.push(term(tr("sentenceSinglePlayer"), "players"));
  } else if (features.includes("multiplayer") || MULTIPLAYER_OPTION_KEYS.some(key => features.includes(key))) {
    line1.push(term(tr("sentenceMultiplayer"), "players"));
    const modes = MULTIPLAYER_OPTION_KEYS.filter(key => features.includes(key)).map(key => {
      const word = PLAYER_MODE_WORDS[key];
      return word ? tr(word) : key;
    });
    if (modes.length) line1.push(plain(" ("), ...list(modes, "players", tr("sentenceAnd")), plain("\u2060)"));
  } else {
    line1.push(term(tr("sentenceAnyPlayers"), "players"));
  }
  line1.push(plain("\u2060."));

  // A review floor reads as part of the same clause, so the line keeps one rhythm.
  const floor = filters.minReviewCount;
  const line2: SentencePart[] = filters.minReviewScore !== undefined
    ? [plain(tr("sentenceScoreLead")), term(tr("sentenceScoreValue", { score: filters.minReviewScore }), "score"),
      plain("\u2060" + tr("sentenceScoreTail") + (floor !== undefined ? tr("sentenceScoreFloor", { count: floor }) : ""))]
    : [plain(tr("sentenceAnyScoreLead")), term(tr("sentenceAnyScore"), "score"),
      plain("\u2060" + tr("sentenceAnyScoreTail") + (floor !== undefined ? tr("sentenceAnyScoreFloor", { count: floor }) : ""))];
  line2.push(plain(tr("sentenceReleasedLead")), term(dateWords(filters, now, locale), "date"), plain("\u2060."));
  return [line1, line2];
}

/** The sentence as plain text, for tests and screen readers. */
export function sentenceText(sentence: FilterSentence): string {
  return sentence.map(line => line.map(part => part.text).join("")).join(" ").replaceAll("\u2060", "");
}
