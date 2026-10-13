import type { CatalogGame } from "./types";
import { normalizeSearchText } from "./libraryText";
import { genreConceptId, genreConceptIds, genreIsSoftware, genreLabel } from "./libraryGenres";
import { capabilityNames, gameMatchesLibraryFeature, hasLanCategory } from "./libraryCapabilities";
import type { LibraryFeatureKey } from "./libraryCapabilities";
import {
  hasQualityFilters,
  gamePassesQualityFilters,
  gameIsAdult,
  gameHasViolenceDescriptor,
  parseReleaseDate,
} from "./libraryQuality";

export { gameMatchesLibraryFeature, normalizeSearchText };
export type { LibraryFeatureKey };
// Re-exported so existing importers keep one entry point for library filtering.
export * from "./libraryQuality";

export const LIBRARY_SEARCH_EVENT = "gameaccess:library-search-query";

export interface LibrarySearchEventDetail {
  query?: string;
}

export interface LibrarySearchFilters {
  genres: string[];
  categories: string[];
  features: LibraryFeatureKey[];
  /** Genres to remove: "adventure but not role-playing". */
  excludeGenres?: string[];
  /** Gameplay capabilities to remove: "simulators that are not racing". */
  excludeFeatures?: LibraryFeatureKey[];
  /** Source names to remove. */
  excludeSources?: string[];
  /** Source names to include. */
  sources?: string[];
  /**
   * What kind of record to search: programs, or everything that is not a program.
   *
   * `true` is a program-only search, `false` is a games-only search. There is no
   * "both" because the two are different universes: a program has no PvP, no LAN,
   * no story mode, so mixing them in one result means the gameplay filters cannot
   * apply to everything on screen.
   *
   * A program is the handful of entries Steam filed under Games whose genres are
   * software classifications (Blender, OBS Studio, Godot Engine). Measured on the
   * published catalog: 10 records.
   */
  software?: boolean;
  /**
   * Valve content descriptor ids to require, e.g. `[1, 3, 4]` for sexual content.
   *
   * Descriptors are Valve's own classification and replace the community tags
   * that used to drive this, which produced false positives like `Blender` and
   * `5D Chess` (tagged `Nudity`, no descriptor) and lost no descriptor games.
   */
  contentDescriptorIds?: number[];
  /**
   * Minimum review percentage (0-100). Not a boolean: "at least 80%" is a
   * different question from "good enough", and a slider expresses it directly.
   * Undefined means no bar.
   */
  minReviewScore?: number;
  /** Earliest release year accepted (inclusive). Undefined means no bound. */
  releaseYearFrom?: number;
  /** Latest release year accepted (inclusive). Undefined means no bound. */
  releaseYearTo?: number;
  /** Hide games Valve marks as adult-only (descriptor 3 or 4). */
  hideAdult?: boolean;
  /** Also hide "some nudity or sexual content" (descriptor 1), e.g. South Park.
   *  A stricter policy, off by default. */
  adultIncludesNudity?: boolean;
  /** Hide descriptor 2, "frequent violence or gore". Independent of hideAdult:
   *  an operator may screen violence without screening adult content. */
  hideViolenceDescriptor?: boolean;
}

/**
 * The default search: everything that is not a program, with no other criterion
 * selected. Programs are excluded because a game search must never return
 * software, and the two are chosen between, not combined.
 *
 * Kept as a function so callers get a fresh object rather than a shared one.
 */
export function defaultLibraryFilters(): LibrarySearchFilters {
  return { ...DEFAULT_LIBRARY_FILTERS };
}

export const DEFAULT_LIBRARY_FILTERS: LibrarySearchFilters = {
  genres: [],
  categories: [],
  features: [],
  software: false,
};

/** Minimum review score (0-100) the library starts with; "Limpiar todo" removes it too. */
export const DEFAULT_MIN_REVIEW_SCORE = 60;

/** What the library opens with: no criteria except hiding poorly reviewed games. */
export const INITIAL_LIBRARY_FILTERS: LibrarySearchFilters = {
  ...DEFAULT_LIBRARY_FILTERS,
  minReviewScore: DEFAULT_MIN_REVIEW_SCORE,
};

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


export function getLibrarySearchFacets(games: CatalogGame[]): LibrarySearchFacets {
  const sortedUnique = (values: string[]) => [...new Set(values.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es"));
  return {
    // Software classifications are excluded here: they are offered as the
    // Software filter instead of as genres, because "Edición fotográfica" is not
    // a way to find a game.
    genres: [...new Set(games.flatMap((game) => gameGenres(game)))]
      .sort((left, right) => genreLabel(left).localeCompare(genreLabel(right), "es")),
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
/**
 * Content groups offered as a positive search.
 *
 * These filter on Valve's official content descriptors, NOT on community tags.
 * Tags are user opinion and demonstrably wrong for this: measured on the
 * published catalog, 2590 games carry a sexual tag while only 2154 of those have
 * a matching descriptor, so tags add 436 false positives. Among them
 * `5D Chess With Multiverse Time Travel` and `Blender` (tagged `Nudity`, no
 * descriptor at all) and `Mortal Kombat 11` (tagged `Sexual Content` while Valve
 * marks it `[2, 5]`, neither sexual).
 *
 * Violence is not here: it is a parental policy, not a discovery criterion.
 */
export const CONTENT_FILTER_GROUPS: {
  id: string;
  label: string;
  /** Valve descriptor ids that satisfy this group. */
  descriptorIds: number[];
}[] = [
  { id: "sexual", label: "Contenido sexual", descriptorIds: [1, 3, 4] },
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

/**
 * Content tags, kept for search enrichment only.
 *
 * These are deliberately NOT a filter. A community tag is user opinion and
 * unreliable in both directions, which is why the content groups filter on
 * Valve's descriptors instead: filtering by tag put `Blender` and `5D Chess` in a
 * sexual-content result. `gameMatchesTags` remains for text search and for
 * enriching what the detail view shows.
 */
export function gameMatchesTags(game: CatalogGame, tags: string[]): boolean {
  if (!tags.length) return true;
  const wanted = new Set(tags.map(tag => tag.trim().toLowerCase()));
  return (game.tags ?? []).some(value => wanted.has(value.trim().toLowerCase()));
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
const SEARCH_TEXT = new WeakMap<CatalogGame, string>();

/**
 * What a text query is matched against: the name and the community tags. Genres,
 * developers and descriptions are deliberately not free text; genres have their
 * own filter, which compares concept ids. Cached per game object so typing does
 * not rebuild 40,000 strings per keystroke.
 */
function searchableText(game: CatalogGame): string {
  let text = SEARCH_TEXT.get(game);
  if (text === undefined) {
    text = normalizeSearchText([game.name, ...(game.tags ?? [])].join(" "));
    SEARCH_TEXT.set(game, text);
  }
  return text;
}

/** Why a game is dropped, so each screen can report its own count. */
type DropReason = "quality" | "adult" | "tag" | "filter" | null;

/**
 * Decide whether one game survives the active filters. Extracted so the pass
 * itself stays readable and testable per rule.
 */
function dropReason(game: CatalogGame, terms: string[], filters: LibrarySearchFilters, now: number): DropReason {
  // The query must match first, otherwise a game that simply was not a search
  // result would later be counted as "hidden by a filter".
  if (terms.length) {
    const searchable = searchableText(game);
    if (!terms.every((term) => searchable.includes(term))) return "filter";
  }
  if (hasQualityFilters(filters) && !gamePassesQualityFilters(game, filters)) {
    return filters.hideAdult && gameIsAdult(game, filters.adultIncludesNudity) ? "adult" : "quality";
  }
  if (classifyFilterMatch(game, filters) === "excluded") return "filter";
  return null;
}

/**
 * The two possible answers. There is no third: a filter is a promise, and a game
 * either satisfies it or does not. See `classifyFilterMatch` for why the old
 * "possible" state was removed.
 */
export type FilterMatch = "confirmed" | "excluded";

/**
 * Does the game satisfy a required criterion?
 *
 * Binary on purpose. The `keys` list exists so callers can name the criterion in
 * diagnostics; it does not soften the answer. A game whose categories cannot
 * confirm the requirement does not satisfy it — an absent answer is not a yes,
 * and the whole "possible" third state was removed for exactly that reason.
 */
function satisfiesCapability(game: CatalogGame, keys: LibraryFeatureKey[]): boolean {
  return keys.some(key => gameMatchesLibraryFeature(game, key));
}

/**
 * Genres in the catalog that are not game genres.
 *
 * The genre list comes from SteamSpy's tag vocabulary, which includes software
 * classifications alongside game genres. Measured on the published catalog these
 * are 10 games: `Blender` (Animación y modelado, Diseño e ilustración, Producción
 * de vídeo), `OBS Studio` (Producción de vídeo, Utilidades), `ShareX`, `Godot
 * Engine`, `Driver Booster 3` and similar titles that Steam itself lists under
 * Games.
 *
 * They are deliberately NOT shown in the genre list: picking "Edición
 * fotográfica" is not a way to find a game. Instead their union is the Software
 * filter, so the user sees one meaningful option instead of eight categories that
 * do not describe games.
 */
export const SOFTWARE_GENRES: readonly string[] = [
  "Animación y modelado",
  "Diseño e ilustración",
  "Edición fotográfica",
  "Producción de audio",
  "Producción de vídeo",
  "Publicación web",
  "Utilidades",
  "Desarrollo de juegos",
  "Educación",
  "Contabilidad",
  // Steam's English spellings of the same classifications. The catalog now
  // carries these, and matching only the Spanish names let them through as games.
  "Utilities",
  "Animation & Modeling",
  "Design & Illustration",
  "Photo Editing",
  "Audio Production",
  "Video Production",
  "Web Publishing",
  "Game Development",
  "Education",
  "Accounting",
  "Software Training",
  "Programming",
];

/**
 * Genre concept ids of a game that are game genres, i.e. everything the panel
 * should offer. Ids such as `racing`, never Steam's text: see libraryGenres.ts.
 */
export function gameGenres(game: CatalogGame): string[] {
  return genreConceptIds(game.genres).filter(id => !genreIsSoftware(id));
}

/** True when the record is one of the software entries Steam filed under Games. */
export function gameIsSoftware(game: CatalogGame): boolean {
  return genreConceptIds(game.genres).some(genreIsSoftware);
}

/** True when no criterion, in either direction, is selected. */
export function hasNoActiveFilters(filters: LibrarySearchFilters): boolean {
  const pairs: [unknown[] | undefined, unknown[] | undefined][] = [
    [filters.genres, filters.excludeGenres],
    [filters.features, filters.excludeFeatures],
    [filters.sources, filters.excludeSources],
    [filters.contentDescriptorIds, undefined],
  ];
  return pairs.every(([include, exclude]) => !include?.length && !exclude?.length)
    && filters.software === undefined
    && !hasQualityFilters(filters);
}

export function filterLibraryGamesDetailed(
  games: CatalogGame[],
  query: string,
  filters: LibrarySearchFilters = DEFAULT_LIBRARY_FILTERS,
): LibraryFilterResult {
  const terms = normalizeSearchText(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length && hasNoActiveFilters(filters)) return { games, hiddenCount: 0, hiddenAdultCount: 0 };

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
      ? { ...game, filter_match: classifyFilterMatch(game, filters) as "confirmed" }
      : game);
  }
  return { games: kept, hiddenCount, hiddenAdultCount };
}

export function filterLibraryGames(
  games: CatalogGame[],
  query: string,
  filters: LibrarySearchFilters = DEFAULT_LIBRARY_FILTERS,
): CatalogGame[] {
  return filterLibraryGamesDetailed(games, query, filters).games;
}

// The UI groups capabilities without making them mutually exclusive.
/**
 * Gameplay criteria grouped for the filter panel.
 *
 * `includeOnly` marks a group where exclusion adds nothing. "Jugadores" is the
 * case the panel was designed around: choosing neither means "both", so a
 * negative would only duplicate an unselected positive. Measured on the real
 * catalog, 389 of 6651 flagged games support single and multiplayer at once, so
 * the two are not actually exclusive — the rule is about the panel's meaning,
 * not about the data.
 */
/**
 * Gameplay criteria, structured as the panel presents them.
 *
 * The players branch is deliberately asymmetric:
 *   - "Solo un jugador" is RESTRICTIVE: it requires single-player and drops
 *     anything that also offers multiplayer.
 *   - "Admite multijugador" is INCLUSIVE: it accepts multiplayer-only games and
 *     games that offer both.
 * The two contradict each other, so the panel disables one when the other is
 * chosen. Everything multiplayer — modes, co-op, PvP — hangs off "Admite
 * multijugador", because none of it means anything for a single-player-only
 * game. Measured on the catalog: 4855 single-player-only, 1395 multiplayer-only
 * and 389 that offer both.
 */
export const PLAYER_FEATURE_KEYS: LibraryFeatureKey[] = ["single_player", "multiplayer"];

/**
 * The multiplayer tree, as the panel renders it.
 *
 * Everything multiplayer hangs off one parent, and inside it each level answers a
 * different question. Options are requirements, never directions: "multiplayer,
 * online, co-op" is a search, and searching for the absence of those is not a
 * use case worth the extra controls.
 *
 * A branch is satisfied by ANY of its selected options, and the branches are
 * combined with AND — exactly the user's query "online co-op/PvE, then combine
 * with role-playing". Measured on the catalog: 4693 games carry Co-op, 5276
 * carry PvP and 2169 carry both, so nothing here is mutually exclusive.
 *
 * PvE sits with Co-op because Steam has no PvE category at all (measured: 0
 * games; it only exists as a community tag on 1342). Keeping it separate, as it
 * was, meant an option that could never match anything.
 */
export const MULTIPLAYER_BRANCHES: {
  id: string;
  label: string;
  hint?: string;
  /**
   * Options in a branch are alternatives (OR). Two branches are both required
   * (AND), so Co-op and PvP are separate branches: "requires Co-op AND requires
   * PvP" is the intersection, while putting them in one branch would make it a
   * union and return all 8529 games with either mode.
   */
  options: { key: LibraryFeatureKey; label: string }[];
  /**
   * The keys that actually satisfy the branch, when that differs from the keys a
   * caller may select. The Co-op branch is the case: selecting "coop" means the
   * generic Co-op requirement, not "any co-op", or an `Online Co-op` game would
   * confirm co-op-over-LAN on online-only evidence.
   */
  requires?: LibraryFeatureKey[];
}[] = [
  {
    id: "coop", label: "Co-op / PvE", hint: "Jugar con otros contra el juego; Steam no tiene categoría PvE, va con Co-op",
    options: [{ key: "coop", label: "Co-op / PvE" }],
    requires: ["coop_generic"],
  },  {
    id: "pvp", label: "PvP", hint: "Jugar contra otros; 2463 juegos tienen Co-op y PvP a la vez",
    options: [{ key: "pvp", label: "PvP" }],
  },
  {
    id: "play", label: "Cómo se juega", hint: "Couch co-op, en red local o por internet",
    options: [
      { key: "shared_split_screen", label: "Pantalla compartida" },
      { key: "lan", label: "LAN" },
      { key: "online_multiplayer", label: "Online" },
    ],
  },
  {
    id: "scale", label: "Escala",
    options: [{ key: "mmo", label: "MMO" }],
  },
];
/** Every option the multiplayer tree can select. */
export const MULTIPLAYER_OPTION_KEYS: LibraryFeatureKey[] =
  MULTIPLAYER_BRANCHES.flatMap(branch => branch.options.map(option => option.key));

/**
 * Criteria that only exist when a game admits multiplayer, so selecting one
 * contradicts "Solo un jugador". Co-op, PvP, the play styles and MMO all qualify:
 * none of them means anything for a single-player-only game.
 */
export const MULTIPLAYER_ONLY_KEYS: LibraryFeatureKey[] = ["multiplayer", ...MULTIPLAYER_OPTION_KEYS];
export const MULTIPLAYER_BRANCH_KEYS: LibraryFeatureKey[] = [...MULTIPLAYER_ONLY_KEYS];

/** Panel labels for the keys the multiplayer tree offers. */
const MULTIPLAYER_LABELS: Partial<Record<LibraryFeatureKey, string>> = Object.fromEntries(
  MULTIPLAYER_BRANCHES.flatMap(branch => branch.options.map(option => [option.key, option.label])),
) as Partial<Record<LibraryFeatureKey, string>>;

export function featureLabel(key: LibraryFeatureKey): string {
  if (key === "local_multiplayer") return "Mismo PC";
  if (key === "online_multiplayer") return "Online";
  if (key === "single_player") return "Solo un jugador";
  if (key === "multiplayer") return "Admite multijugador";
  return MULTIPLAYER_LABELS[key] ?? LIBRARY_FEATURE_OPTIONS.find(option => option.key === key)?.label ?? key;
}

/**
 * Negative criteria, plus the requirements that are absolute.
 *
 * Every group carries the same tri-state semantics: positive criteria are a
 * search, negative criteria are a screen. A negative never fires on missing
 * metadata, because absence of evidence is not evidence of the feature.
 */
function screenOutGame(game: CatalogGame, filters: LibrarySearchFilters): boolean {
  if (filters.sources?.length && !filters.sources.some(name => game.download_source_names?.includes(name))) return true;
  if ((filters.excludeSources ?? []).some(name => game.download_source_names?.includes(name))) return true;
  if (filters.features.includes("has_downloads") && !game.has_downloads) return true;
  if (filters.excludeFeatures?.some(key => gameMatchesLibraryFeature(game, key))) return true;
  if (filters.excludeGenres?.length) {
    // Selections saved before genres were normalized may use an old spelling.
    const excluded = filters.excludeGenres.map(genreConceptId).filter((id): id is string => id !== null);
    if (gameGenres(game).some(genre => excluded.includes(genre))) return true;
  }
  // Tags are intentionally absent here: they are search material, not criteria.
  return false;
}

/**
 * The players branch, which is asymmetric:
 *   "Admite multijugador" is INCLUSIVE: multiplayer-only, or both.
 *   "Solo un jugador" is RESTRICTIVE: single-player and nothing else.
 */
function checkPlayersBranch(game: CatalogGame, filters: LibrarySearchFilters): boolean {
  if (filters.features.includes("multiplayer") && !gameMatchesLibraryFeature(game, "multiplayer")) return false;
  if (!filters.features.includes("single_player")) return true;
  // "Solo un jugador" is the restrictive side: a game that also offers
  // multiplayer does not qualify, or the label would be false for the 389
  // catalog games that offer both.
  if (gameMatchesLibraryFeature(game, "multiplayer")) return false;
  // It also has to positively BE a single-player game. Being "not multiplayer" is
  // not the same claim: a record with no categories at all is neither, and
  // without this a software entry like Blender came back in a single-player-only
  // search.
  if (!gameMatchesLibraryFeature(game, "single_player")) return false;
  // A criterion that only exists with multiplayer contradicts "Solo un jugador".
  return !MULTIPLAYER_ONLY_KEYS.some(key => filters.features.includes(key));
}

/**
 * The multiplayer tree.
 *
 * Structure decides the logic, and the two levels mean different things:
 *   - branches are ANDed: "Co-op" and "LAN" must both hold
 *   - options inside a branch are ORed: "LAN or Online" is either
 *
 * Co-op and PvP get one branch each despite both being "the mode", because
 * requiring both modes is a conjunction; grouping them as alternatives would
 * return every game with either mode (measured: 8529 instead of 2463).
 *
 * Each option is a plain requirement on its own concept. No branch cross-checks
 * another: a `LAN Co-op` category satisfies Co-op and LAN at once, which is the
 * whole point of keeping the concepts independent.
 */
function checkMultiplayerTree(game: CatalogGame, filters: LibrarySearchFilters): boolean {
  for (const branch of MULTIPLAYER_BRANCHES) {
    const selected = branch.options.map(option => option.key).filter(key => filters.features.includes(key));
    if (!selected.length) continue;
    if (!satisfiesCapability(game, branch.requires ?? selected)) return false;
  }
  return true;
}

/**
 * Any capability the panel can select outside the tree. Kept so a key added to
 * the type without a home in the tree still gets evaluated rather than silently
 * ignored.
 */
function checkLooseCapabilities(game: CatalogGame, filters: LibrarySearchFilters): boolean {
  const known = new Set<LibraryFeatureKey>([...MULTIPLAYER_ONLY_KEYS, ...PLAYER_FEATURE_KEYS,
    ...MULTIPLAYER_BRANCHES.flatMap(branch => branch.options.map(option => option.key))]);
  const loose = filters.features.filter(key => !known.has(key));
  if (!loose.length) return true;
  return satisfiesCapability(game, loose);
}

/**
 * A filter is a promise, so this answer is binary: a game matches a required
 * criterion or it does not. There is no third "maybe" state.
 *
 * The catalog has gaps — 2206 games carry no categories at all and community
 * tags are opinion rather than an answer — but a gap is not evidence, so a game
 * whose data cannot confirm a criterion is not part of that criterion's results.
 * Returning it anyway is what put Age of Empires III in a co-op search.
 *
 * Community tags stay searchable as text (see `filterLibraryGames`) and will
 * later be something the user can add per game, which is the right way to fill a
 * gap: the user asserts the fact, we do not guess it.
 */
/**
 * The content screens that are not a capability: what kind of record this is, and
 * which Valve descriptors it carries.
 *
 * Both are requirements, so a record that cannot satisfy one is not a result.
 */
function screenOutByContent(game: CatalogGame, filters: LibrarySearchFilters): boolean {
  // Content groups ask for Valve descriptors. A game without the descriptor is
  // not a result, even if its community tags suggest otherwise.
  if (filters.contentDescriptorIds?.length) {
    const descriptors = game.content_descriptorids ?? [];
    if (!filters.contentDescriptorIds.some(id => descriptors.includes(id))) return true;
  }
  // The Software choice: programs and games are separate searches, never blended.
  if (filters.software !== undefined && gameIsSoftware(game) !== filters.software) return true;
  return false;
}

export function classifyFilterMatch(game: CatalogGame, filters: LibrarySearchFilters): FilterMatch {
  if (screenOutGame(game, filters)) return "excluded";
  if (screenOutByContent(game, filters)) return "excluded";
  if (filters.genres.length) {
    const wanted = filters.genres.map(genreConceptId).filter((id): id is string => id !== null);
    const own = gameGenres(game);
    if (!wanted.some(genre => own.includes(genre))) return "excluded";
  }
  for (const verdict of [checkPlayersBranch(game, filters), checkMultiplayerTree(game, filters), checkLooseCapabilities(game, filters)]) {
    if (!verdict) return "excluded";
  }
  // "Solo un jugador" is the restrictive half of the partition, so its exclusivity
  // belongs here rather than in the capability predicate: the label promises
  // single-player and nothing else. A record reporting both flags (measured: 12,
  // e.g. Battlefield 6) supports both, so it is not a single-player-only game.
  if (filters.features.includes("single_player")
    && gameMatchesLibraryFeature(game, "single_player")
    && gameMatchesLibraryFeature(game, "multiplayer")) {
    return "excluded";
  }
  return "confirmed";
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
