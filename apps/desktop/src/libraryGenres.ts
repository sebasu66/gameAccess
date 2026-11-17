/**
 * Genres as internal concepts, independent of language and spelling.
 *
 * Same approach as the multiplayer categories (docs/CATALOG_FILTER_MAPPING.md):
 * every genre a game carries is resolved to a stable concept id such as `racing`,
 * and the filters, facets and search compare ONLY against that id, never against
 * Steam's text. The catalog mixes Steam's English genre list, translated legacy
 * values and community labels (100 distinct values for ~45 concepts), so
 * `Racing` and `Carreras` are one concept, as are `RPG` / `Role-playing (RPG)` /
 * `Rol` and `Sport` / `Sports` / `Deportes`.
 *
 * The table is data (genreConcepts.json), generated-doc friendly and shared with
 * the catalog pipeline. A value that matches no alias is NOT guessed: it becomes
 * its own concept with a slug id and keeps its text as the label, so nothing is
 * silently merged or dropped, but it is not offered as a choice (offeredGenres).
 * docs/CATALOG_GENRE_MAPPING.md lists those leftovers.
 *
 * What is stored is `canonical`: the catalog pipeline and the client's database
 * (catalog_genres.rs) write only that. What is shown is `genre_<id>` in the
 * translations, in the app's language, and never the stored text.
 */
import table from "./genreConcepts.json";
import { getAppLocale, translate, type TranslationKey } from "./i18n";
import { normalizeSearchText } from "./libraryText";

interface GenreConcept {
  id: string;
  /** Steam's English name; what the published catalog stores. */
  canonical: string;
  /** One more Spanish spelling; what the UI shows is the translation `genre_<id>`. */
  label: string;
  aliases: string[];
  software?: boolean;
}

const CONCEPTS: GenreConcept[] = table.concepts;
const NOT_A_GENRE = new Set(table.not_a_genre.map(value => normalizeSearchText(value)));

const BY_ID = new Map<string, GenreConcept>(CONCEPTS.map(concept => [concept.id, concept]));
/** Normalized alias, label or id to concept. */
const BY_KEY = new Map<string, GenreConcept>();
for (const concept of CONCEPTS) {
  for (const key of [concept.id.replace(/_/g, " "), concept.canonical, concept.label, ...concept.aliases]) {
    BY_KEY.set(normalizeSearchText(key), concept);
  }
}
/** Concepts met in data that the table does not know: id to the text first seen. */
const UNMAPPED = new Map<string, string>();

function slug(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "other";
}

/**
 * The concept id for a value, or null when it is not a genre (empty, or a
 * maturity label that belongs to Valve's content descriptors). Accepts a catalog
 * value in any language, a concept id, or a UI label, so selections saved under
 * an older spelling keep working.
 */
export function genreConceptId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const key = normalizeSearchText(trimmed);
  if (NOT_A_GENRE.has(key)) return null;
  const known = BY_KEY.get(key);
  if (known) return known.id;
  const id = slug(trimmed);
  if (BY_ID.has(id)) return id;
  if (!UNMAPPED.has(id)) UNMAPPED.set(id, trimmed);
  return id;
}

/** Concept ids of a game, de-duplicated, first-seen order. */
export function genreConceptIds(values: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const id = genreConceptId(value);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** UI label of a concept in the app's language; the catalog's own text for one the table does not know. */
export function genreLabel(id: string): string {
  // Also accepts an older spelling saved in a filter ("Racing" -> "Carreras").
  const concept = BY_ID.get(id) ?? BY_KEY.get(normalizeSearchText(id));
  return concept ? translate(`genre_${concept.id}` as TranslationKey) : UNMAPPED.get(id) ?? id.replace(/_/g, " ");
}

/** A game's genres as they are shown, whatever language they came in. */
export function genreLabels(values: readonly string[] | null | undefined): string[] {
  return genreConceptIds(values).map(genreLabel);
}

/** The genres a player can choose from: only concepts of the table, games only, in the app's alphabetical order. */
export function offeredGenres(names: readonly string[]): string[] {
  return genreConceptIds(names).filter(id => BY_ID.has(id) && !genreIsSoftware(id))
    .sort((left, right) => genreLabel(left).localeCompare(genreLabel(right), getAppLocale()));
}

/** The concept's stored English name, the one language-independent text (what the AI is told). */
export function genreStoredName(id: string): string {
  return (BY_ID.get(id) ?? BY_KEY.get(normalizeSearchText(id)))?.canonical ?? genreLabel(id);
}

/** Labels about how a game is sold or made, not what it is: they never name a deck. */
const NOT_A_DECK = new Set(["indie", "early_access", "free_to_play"]);
/** Too broad, or a setting rather than a way to play: a deck only when nothing more telling is there. */
const WEAK_DECK = new Set(["casual", "massively_multiplayer", "open_world", "fantasy", "sci_fi", "mystery", "adventure"]);

/**
 * A known concept of the table for a value, without recording community tags it does not know (Steam has hundreds).
 * Steam's many "… Sim" tags (Farming Sim, Life Sim, Automobile Sim) are simulations.
 */
function knownConcept(value: string): GenreConcept | undefined {
  const key = normalizeSearchText(value);
  if (NOT_A_GENRE.has(key)) return undefined;
  return BY_KEY.get(key) ?? (key.endsWith(" sim") ? BY_ID.get("simulation") : undefined);
}

/**
 * The one genre a game is mostly, for the library's decks. Steam's own genre list has no weight (it always comes in
 * Steam's fixed order and a game carries up to seven), but the store's community tags come heaviest first
 * (`tag_sources["steam-store"]`, ordered by apps/api catalog_artwork.py), so the first tag that is a genre of the table
 * says what players think the game is. Broad labels and settings (casual, open world, fantasy…) only win when nothing more telling is
 * there; labels like Indie or Early Access never do. Null for a game with no genre, or software.
 */
export function primaryGenre(game: { genres?: readonly string[] | null; tag_sources?: Record<string, string[]> | null }): string | null {
  const candidates: string[] = [];
  for (const value of [...game.tag_sources?.["steam-store"] ?? [], ...game.genres ?? []]) {
    const concept = knownConcept(value);
    if (concept && !concept.software && !NOT_A_DECK.has(concept.id)) candidates.push(concept.id);
  }
  return candidates.find(id => !WEAK_DECK.has(id)) ?? candidates[0] ?? null;
}

/** The genres a game's deck can be chosen from (the game's card), in the app's alphabetical order. */
export function deckGenres(): string[] {
  return CONCEPTS.filter(concept => !concept.software && !NOT_A_DECK.has(concept.id)).map(concept => concept.id)
    .sort((left, right) => genreLabel(left).localeCompare(genreLabel(right), getAppLocale()));
}

export function genreIsSoftware(id: string): boolean {
  return BY_ID.get(id)?.software === true;
}

/** Steam's English spelling, the form the published catalog stores. */
export function canonicalGenre(raw: string | null | undefined): string | null {
  const id = genreConceptId(raw);
  if (id === null) return null;
  return BY_ID.get(id)?.canonical ?? (typeof raw === "string" ? raw.trim() : null);
}

export function canonicalGenres(values: readonly string[] | null | undefined): string[] {
  return genreConceptIds(values).map(id => BY_ID.get(id)?.canonical ?? genreLabel(id));
}
