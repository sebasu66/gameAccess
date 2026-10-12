import type { CatalogGame } from "./types";

export const LIBRARY_SEARCH_EVENT = "gameaccess:library-search-query";

export interface LibrarySearchEventDetail {
  query?: string;
}

export type LibraryFeatureKey =
  | "single_player"
  | "multiplayer"
  | "online_multiplayer"
  | "local_multiplayer"
  | "coop"
  | "online_coop"
  | "local_coop"
  | "coop_lan"
  | "multiplayer_lan"
  | "lan"
  | "shared_split_screen"
  | "mmo"
  | "pvp"
  | "pve"
  | "cross_platform"
  | "has_downloads";

export interface LibrarySearchFilters {
  genres: string[];
  categories: string[];
  features: LibraryFeatureKey[];
  /** Steam community tags; OR within the group, AND against other groups. */
  tags?: string[];
  includeUncertain?: boolean;
  sources?: string[];
  /** Hide games older than a month with no reviews at all. */
  hideNoReviews?: boolean;
  /** Hide games older than a month whose review score is below the bar. */
  hideLowRated?: boolean;
  /** Hide games older than a month whose reviews are too few to matter. */
  hideFewReviews?: boolean;
  /** Hide games known to carry adult content descriptors. */
  hideAdult?: boolean;
  /** Also treat violence/gore tags as adult. Off by default: they catch
   *  mainstream action titles, which is a different policy choice. */
  adultIncludesViolence?: boolean;
}

/**
 * Default filter set: the quality screens start ON, as requested, and remain
 * toggleable from the filter panel. Kept as a function so callers get a fresh
 * object rather than a shared mutable one.
 */
export function defaultLibraryFilters(): LibrarySearchFilters {
  return { genres: [], categories: [], features: [], tags: [], hideNoReviews: true, hideLowRated: true, hideFewReviews: true };
}

/** Every game hidden by the three quality screens, whatever the split. */
export function gameIsShitty(game: CatalogGame, now = Date.now()): boolean {
  return gameIsUnratedJunk(game, now) || gameIsLowRated(game, now) || gameHasTooFewReviews(game, now);
}

export const EMPTY_LIBRARY_FILTERS: LibrarySearchFilters = {
  genres: [],
  categories: [],
  features: [],
};

/** Days after release before an absent review record counts as a bad sign. */
export const UNRATED_GRACE_DAYS = 30;
/** Review percentage below which a game is considered poorly received. */
export const LOW_REVIEW_SCORE = 50;
/** A good score backed by fewer reviews than this is not yet trustworthy. */
export const MIN_REVIEWS_FOR_CONFIDENCE = 100;

/**
 * Release dates arrive in two shapes: ISO (`2009-05-14`, the common one by far)
 * and a localized label (`12 AGO 2016`, `12 Aug, 2026`). Reading only one of
 * them silently mis-dates almost the whole catalog, so both are accepted.
 * Month names cover Spanish and English because the catalog is requested in the
 * user's Steam language.
 */
const LOCALIZED_MONTHS: Record<string, number> = {
  ene: 1, jan: 1,
  feb: 2,
  mar: 3,
  abr: 4, apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8, aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dic: 12, dec: 12,
};

export function parseReleaseDate(value?: string | null): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const parts = raw.replace(/,/g, " ").split(/\s+/);
  if (parts.length >= 3) {
    const day = Number.parseInt(parts[0], 10);
    const month = LOCALIZED_MONTHS[parts[1]?.slice(0, 3).toLowerCase()];
    const year = Number.parseInt(parts[2], 10);
    if (Number.isFinite(day) && month && Number.isFinite(year)) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }
  // "Por confirmarse", "To be announced", "Q1 2027" and friends are unknown,
  // not old: an unreadable date must never be treated as a stale release.
  return null;
}

export function isOlderThanGrace(game: CatalogGame, now = Date.now()): boolean {
  const released = parseReleaseDate(game.release_date);
  if (!released) return false;
  return now - released.getTime() > UNRATED_GRACE_DAYS * 86_400_000;
}

export function gameIsUnratedJunk(game: CatalogGame, now = Date.now()): boolean {
  if (!isOlderThanGrace(game, now)) return false;
  // A score of any kind means someone reviewed it; only a total absence counts.
  if (typeof game.steam_review_score === "number") return false;
  return !(game.steam_review_count ?? 0);
}

/**
 * The three quality screens. All of them are gated on release age: the month is
 * the entry condition, not a sibling rule, so a recent release is never judged
 * for lacking reviews. A game with an unreadable date is unknown, not old.
 */
export function gameIsLowRated(game: CatalogGame, now = Date.now()): boolean {
  const score = game.steam_review_score;
  return typeof score === "number" && score < LOW_REVIEW_SCORE && isOlderThanGrace(game, now);
}

export function gameHasTooFewReviews(game: CatalogGame, now = Date.now()): boolean {
  const score = game.steam_review_score;
  // Only a good-but-unproven score belongs here. A missing score is the first
  // screen's business and a bad score is the second's; without this the three
  // screens would overlap and the UI could not tell them apart.
  if (typeof score !== "number" || score < LOW_REVIEW_SCORE) return false;
  return isOlderThanGrace(game, now) && (game.steam_review_count ?? 0) < MIN_REVIEWS_FOR_CONFIDENCE;
}

/**
 * Steam community tags that indicate sexual or explicit adult content. The
 * packaged catalog carries no age rating, so tags are the only signal available
 * at install time. They are a proxy, not a classification.
 *
 * This list is deliberately narrow. Measured against the real catalog, `mature`
 * matches Batman: Arkham Knight and `violent` matches Hellblade — mainstream
 * titles, not adult content. A parental filter that hides those would be wrong
 * far more often than it is right, so violence tags are handled separately and
 * are off unless the operator asks for them.
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

function tagMatch(values: string[] | null | undefined, tags: readonly string[]): string | null {
  if (!values?.length) return null;
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (tags.some(tag => normalized === tag)) return value;
  }
  return null;
}

/**
 * Adult titles are recognised from two sources, in order of authority:
 *   1. the age rating / content descriptors from Steam's detail payload,
 *   2. Steam community tags already present in the packaged catalog.
 *
 * Step 2 exists because the catalog has no rating field today; without it the
 * parental filter would silently block nothing.
 */
export function gameIsAdult(game: CatalogGame, includeViolenceTags = false): boolean {
  if (game.adult_only === true) return true;
  const age = typeof game.required_age === "string" ? Number.parseInt(game.required_age, 10) : game.required_age;
  if (typeof age === "number" && Number.isFinite(age)) return age >= 18;
  if ((game.content_descriptors ?? []).some(descriptor => /adult|sexual|nudity|hentai/i.test(descriptor))) return true;
  if (adultReason(game, includeViolenceTags)) return true;
  return false;
}

/** Which signal flagged the game, for diagnostics and the hidden notice. */
export function adultReason(game: CatalogGame, includeViolenceTags = false): string | null {
  if (game.adult_only === true) return "adult_only";
  const age = typeof game.required_age === "string" ? Number.parseInt(game.required_age, 10) : game.required_age;
  if (typeof age === "number" && Number.isFinite(age) && age >= 18) return `required_age=${age}`;
  const descriptor = (game.content_descriptors ?? []).find(value => /adult|sexual|nudity|hentai/i.test(value));
  if (descriptor) return `descriptor:${descriptor}`;
  const explicit = tagMatch(game.tags, ADULT_CONTENT_TAGS) ?? tagMatch(game.genres, ADULT_CONTENT_TAGS);
  if (explicit) return `tag:${explicit}`;
  if (!includeViolenceTags) return null;
  const violence = tagMatch(game.tags, VIOLENCE_CONTENT_TAGS) ?? tagMatch(game.genres, VIOLENCE_CONTENT_TAGS);
  return violence ? `violence-tag:${violence}` : null;
}

/** Any active catalog-quality filter, so callers can skip the work when idle. */
export function hasQualityFilters(filters: LibrarySearchFilters): boolean {
  return Boolean(filters.hideNoReviews || filters.hideLowRated || filters.hideFewReviews || filters.hideAdult);
}

export function gamePassesQualityFilters(game: CatalogGame, filters: LibrarySearchFilters, now = Date.now()): boolean {
  if (filters.hideAdult && gameIsAdult(game, filters.adultIncludesViolence)) return false;
  if (filters.hideNoReviews && gameIsUnratedJunk(game, now)) return false;
  if (filters.hideLowRated && gameIsLowRated(game, now)) return false;
  if (filters.hideFewReviews && gameHasTooFewReviews(game, now)) return false;
  return true;
}

export const LIBRARY_FEATURE_OPTIONS: { key: LibraryFeatureKey; label: string }[] = [
  { key: "has_downloads", label: "Descargables (Fuentes disponibles)" },
  { key: "single_player", label: "Un jugador" },
  { key: "multiplayer", label: "Multijugador" },
  { key: "online_multiplayer", label: "Multiplayer online" },
  { key: "local_multiplayer", label: "Multiplayer local" },
  { key: "coop", label: "Cooperativo" },
  { key: "online_coop", label: "Co-op online" },
  { key: "local_coop", label: "Co-op local" },
  { key: "coop_lan", label: "Co-op LAN" },
  { key: "multiplayer_lan", label: "Multiplayer LAN" },
  { key: "lan", label: "LAN" },
  { key: "shared_split_screen", label: "Pantalla dividida / compartida" },
  { key: "mmo", label: "MMO" },
  { key: "pvp", label: "Competitivo / PvP" },
  { key: "pve", label: "Contra el entorno / PvE" },
  { key: "cross_platform", label: "Multiplataforma" },
];

export interface LibrarySearchFacets {
  genres: string[];
  categories: string[];
  features: LibraryFeatureKey[];
  tags: string[];
}

function hasLanCategory(game: CatalogGame): boolean {
  return game.steam_category_ids?.includes(48) === true || (game.categories ?? []).some((category) => (
    normalizeSearchText(category).split(/[^a-z0-9]+/).includes("lan")
  ));
}

// Stable IDs verified against Steam Store appdetails categories. Old server
// records still use localized descriptions; local refreshes retain IDs too.
const CAPABILITY_NAMES: Record<number, string> = { 1: "Multi-player", 2: "Single-player", 9: "Co-op", 24: "Shared/Split Screen", 36: "Online PvP", 38: "Online Co-op", 39: "Shared/Split Screen Co-op", 48: "LAN Co-op", 49: "PvP" };
function capabilityNames(game: CatalogGame): string[] {
  return [...(game.categories ?? []), ...(game.steam_category_ids ?? []).flatMap(id => CAPABILITY_NAMES[id] ? [CAPABILITY_NAMES[id]] : [])].map(normalizeSearchText);
}

export function gameMatchesLibraryFeature(game: CatalogGame, feature: LibraryFeatureKey): boolean {
  // Digital and older catalog records can have categories without boolean flags.
  // Match actual Steam capability evidence, never community tags or descriptions.
  const categories = capabilityNames(game);
  const has = (...names: string[]) => categories.some(category => names.some(name => category.includes(name)));
  const coop = game.coop === true || has("co-op", "coop", "cooperativ");
  const onlineCoop = game.online_coop === true || has("online co-op", "online coop", "cooperativo en linea");
  const localCoop = game.local_coop === true || has("local co-op", "local coop", "cooperativo local", "shared/split screen co-op", "cooperativo de pantalla", "coop. a pantalla");
  const shared = game.shared_split_screen === true || has("shared/split screen", "shared split screen", "pantalla dividida", "pantalla compartida", "pantalla (com)partida", "pantalla partida");
  const onlineMulti = onlineCoop || has("jcj en linea", "online pvp", "multijugador en linea", "online multiplayer");
  const localMulti = localCoop || shared || has("local multiplayer", "multijugador local", "jcj de pantalla");
  const lan = hasLanCategory(game);
  if (feature === "has_downloads") return (game as any).has_downloads === true;
    if (feature === "lan") return lan;
  if (feature === "coop_lan") return has("lan co-op", "lan coop", "cooperativo en lan", "coop. en lan");
  if (feature === "multiplayer_lan") return lan;
  if (feature === "online_multiplayer") return onlineMulti;
  if (feature === "local_multiplayer") return localMulti;
  if (feature === "single_player") return game.single_player === true || has("single-player", "single player", "un jugador");
  if (feature === "multiplayer") return game.multiplayer === true || onlineMulti || localMulti || lan || coop || game.pvp === true || has("pvp", "jcj") || game.mmo === true || has("multi-player", "multiplayer", "multijugador", "massively multiplayer");
  if (feature === "coop") return coop || onlineCoop || localCoop;
  if (feature === "online_coop") return onlineCoop;
  if (feature === "local_coop") return localCoop;
  if (feature === "shared_split_screen") return shared;
  if (feature === "mmo") return game.mmo === true || has("mmo", "massively multiplayer", "multijugador masivo");
  if (feature === "cross_platform") return has("cross-platform multiplayer", "multijugador multiplataforma");
  if (feature === "pve") return has("pve", "jce");
  if (feature === "pvp") return game.pvp === true || has("pvp", "jcj");
  return false;
}

export function getLibrarySearchFacets(games: CatalogGame[]): LibrarySearchFacets {
  const sortedUnique = (values: string[]) => [...new Set(values.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es"));
  return {
    genres: sortedUnique(games.flatMap((game) => game.genres ?? [])),
    // Steam capability categories are intentionally hidden from the UI.
    categories: [],
    features: LIBRARY_FEATURE_OPTIONS
      .filter(({ key }) => games.some((game) => gameMatchesLibraryFeature(game, key)))
      .map(({ key }) => key),
    // Steam community tags are the only content classification the packaged
    // catalog actually carries; `genres` holds a translated handful.
    tags: sortedUnique(games.flatMap((game) => game.tags ?? [])),
  };
}

/**
 * Content tags offered as a first-class filter group, split by meaning.
 * Violence tags catch mainstream action titles (measured: `Mature` matches
 * Batman: Arkham Knight, `Violent` matches Hellblade), so they are never
 * implied by the sexual group.
 */
export const SEXUAL_CONTENT_TAGS = ["Hentai", "Sexual Content", "Nudity"] as const;
export const VIOLENCE_CONTENT_TAGS_UI = ["Gore", "Violent", "Mature"] as const;
export const CONTENT_FILTER_GROUPS: { id: string; label: string; tags: string[] }[] = [
  { id: "sexual", label: "Contenido sexual", tags: [...SEXUAL_CONTENT_TAGS] },
  { id: "violence", label: "Violencia y gore", tags: [...VIOLENCE_CONTENT_TAGS_UI] },
];

/**
 * How many of `games` carry each tag, so the filter list can show real counts
 * instead of the misleading genre counts.
 */
export function getTagCounts(games: CatalogGame[], tags: readonly string[]): Map<string, number> {
  const wanted = new Map(tags.map(tag => [tag.toLowerCase(), tag]));
  const counts = new Map<string, number>();
  for (const game of games) {
    const seen = new Set<string>();
    for (const value of game.tags ?? []) {
      const canonical = wanted.get(value.trim().toLowerCase());
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical);
        counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Tag match is OR within the group and case-insensitive against the catalog. */
export function gameMatchesTags(game: CatalogGame, tags: string[]): boolean {
  if (!tags.length) return true;
  const wanted = new Set(tags.map(tag => tag.trim().toLowerCase()));
  return (game.tags ?? []).some(value => wanted.has(value.trim().toLowerCase()));
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

export interface LibraryFilterResult {
  games: CatalogGame[];
  /** Games dropped by the quality screens, for the "N hidden" notice. */
  hiddenCount: number;
  /** Games dropped specifically by the adult screen, reported separately so a
   *  parental block is never silently merged into a quality count. */
  hiddenAdultCount: number;
}

/**
 * Filter by query and filters, and report how many games each screen removed so
 * the UI can say so instead of appearing to have lost results.
 */
/** Why a game is dropped, so each screen can report its own count. */
type DropReason = "quality" | "adult" | "tag" | "filter" | null;

/**
 * Decide whether one game survives the active filters. Extracted so the pass
 * itself stays readable and testable per rule.
 */
function dropReason(game: CatalogGame, terms: string[], filters: LibrarySearchFilters, now: number): DropReason {
  const tags = filters.tags ?? [];
  // The query must match first, otherwise a game that simply was not a search
  // result would later be counted as "hidden by a filter".
  if (terms.length) {
    const searchable = normalizeSearchText([game.name, ...(game.tags ?? [])].join(" "));
    if (!terms.every((term) => searchable.includes(term))) return "filter";
  }
  if (hasQualityFilters(filters) && !gamePassesQualityFilters(game, filters, now)) {
    return filters.hideAdult && gameIsAdult(game, filters.adultIncludesViolence) ? "adult" : "quality";
  }
  if (!gameMatchesTags(game, tags)) return "tag";
  if (classifyFilterMatch(game, filters) === "excluded") return "filter";
  return null;
}

export function filterLibraryGamesDetailed(
  games: CatalogGame[],
  query: string,
  filters: LibrarySearchFilters = EMPTY_LIBRARY_FILTERS,
): LibraryFilterResult {
  const terms = normalizeSearchText(query.trim()).split(/\s+/).filter(Boolean);
  const tags = filters.tags ?? [];
  const idle = !terms.length && !filters.genres.length && !filters.features.length
    && !filters.sources?.length && !tags.length && !hasQualityFilters(filters);
  if (idle) return { games, hiddenCount: 0, hiddenAdultCount: 0 };

  // One clock reading for the whole pass: timing each game separately would
  // make the result depend on how long the loop took.
  const now = Date.now();
  const kept: CatalogGame[] = [];
  let hiddenCount = 0;
  let hiddenAdultCount = 0;
  for (const game of games) {
    const reason = dropReason(game, terms, filters, now);
    if (reason === "adult") hiddenAdultCount++;
    if (reason === "adult" || reason === "quality") hiddenCount++;
    if (reason !== null) continue;
    kept.push(filters.genres.length || filters.features.length
      ? { ...game, filter_match: classifyFilterMatch(game, filters) as "confirmed" | "possible" }
      : game);
  }
  return { games: kept, hiddenCount, hiddenAdultCount };
}

export function filterLibraryGames(
  games: CatalogGame[],
  query: string,
  filters: LibrarySearchFilters = EMPTY_LIBRARY_FILTERS,
): CatalogGame[] {
  return filterLibraryGamesDetailed(games, query, filters).games;
}

// The UI groups capabilities without making them mutually exclusive.
export const GAMEPLAY_FILTER_GROUPS: { id: string; label: string; options: LibraryFeatureKey[] }[] = [
  { id: "players", label: "Jugadores", options: ["single_player", "multiplayer"] },
  { id: "style", label: "Cómo se juega", options: ["coop", "pvp", "pve"] },
  { id: "connection", label: "Dónde se juega", options: ["local_multiplayer", "lan", "online_multiplayer"] },
  { id: "features", label: "Características", options: ["shared_split_screen", "cross_platform", "mmo", "has_downloads"] },
];
export function featureLabel(key: LibraryFeatureKey): string {
  if (key === "local_multiplayer") return "Mismo PC";
  if (key === "online_multiplayer") return "Online";
  return LIBRARY_FEATURE_OPTIONS.find(option => option.key === key)?.label ?? key;
}
export type FilterMatch = "confirmed" | "possible" | "excluded";

/** Positive capability evidence confirms a match. Missing child metadata never
 * proves absence. Tags can hint, but cannot confirm a Steam capability.
 * Multiple choices in a group are OR; separate groups narrow together. */
export function classifyFilterMatch(game: CatalogGame, filters: LibrarySearchFilters): FilterMatch {
  if (filters.sources?.length && !filters.sources.some(name => game.download_source_names?.includes(name))) return "excluded";
  if (filters.features.includes("has_downloads") && !game.has_downloads) return "excluded";
  // Tag selection is an exclusion, not a "possible": either the game carries the
  // tag or it does not. Missing tags never count as a match.
  if (filters.tags?.length && !gameMatchesTags(game, filters.tags)) return "excluded";
  let possible = false;
  if (filters.genres.length && !filters.genres.some(genre => game.genres?.includes(genre))) {
    if (game.genres?.length) return "excluded";
    possible = true;
  }
  const hasMulti = gameMatchesLibraryFeature(game, "multiplayer");
  const soloOnly = gameMatchesLibraryFeature(game, "single_player") && !hasMulti;
  const groups = GAMEPLAY_FILTER_GROUPS.map(group => filters.features.filter(key => group.options.includes(key)));
  const legacy = filters.features.filter(key => !GAMEPLAY_FILTER_GROUPS.some(group => group.options.includes(key)));
  if (legacy.length) groups.push(legacy);
  for (const selected of groups) {
    if (!selected.length || selected.some(key => gameMatchesLibraryFeature(game, key))) continue;
    // A positively identified solo-only game is not a possible multiplayer result.
    if (soloOnly && !selected.includes("single_player") && !selected.includes("pve")) return "excluded";
    possible = true;
  }
  // A game may have Online Co-op and LAN PvP simultaneously: never invent LAN Co-op.
  const styles = filters.features.filter(key => key === "coop" || key === "pvp");
  const connections = filters.features.filter(key => ["lan", "online_multiplayer", "local_multiplayer"].includes(key));
  const screen = filters.features.includes("shared_split_screen") && !filters.features.some(key => key === "mmo" || key === "cross_platform");
  if (styles.length && (connections.length || screen)) {
    const categories = capabilityNames(game);
    const styleMatches = (category: string, style: LibraryFeatureKey) => style === "coop" ? /co-op|coop|cooperativ/.test(category) : /pvp|jcj/.test(category);
    const connectionEvidence = !connections.length || styles.some(style => categories.some(category =>
      styleMatches(category, style) && connections.some(connection =>
        connection === "lan" ? /\blan\b/.test(category)
          : connection === "online_multiplayer" ? /online|en linea/.test(category)
          : /shared|split|local|pantalla/.test(category))));
    // Screen support and LAN/online support can be distinct modes in one game.
    const screenEvidence = !screen || styles.some(style => categories.some(category => styleMatches(category, style) && /shared|split|pantalla/.test(category)));
    const evidence = connectionEvidence && screenEvidence;
    if (!evidence) possible = true;
  }
  return possible ? filters.includeUncertain === false ? "excluded" : "possible" : "confirmed";
}

export function findLibraryLetter(games: CatalogGame[], key: string, selectedIndex: number): number {
  if (!/^\p{L}$/u.test(key)) return -1;
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
  for (let offset = 1; offset <= games.length; offset += 1) {
    const index = (selectedIndex + offset + games.length) % games.length;
    if (normalize(games[index].name.trim()).startsWith(normalize(key))) return index;
  }
  return -1;
}
