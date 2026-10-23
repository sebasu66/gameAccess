/**
 * Steam capability evidence: which player modes and features a game supports.
 *
 * Kept apart from the search text handling because this is the part that has to
 * be right for the gameplay filters. Two rules run through it:
 *
 *  - Only real capability evidence counts. Community tags and store descriptions
 *    are user opinion, so `Mature` or `Co-op` as a tag never confirms a feature.
 *  - Ids are preferred over text. The packaged catalog's category text is
 *    localized ("JcJ" for PvP, "Un jugador" for Single-player), so the id map
 *    below is the reliable path and the text patterns only cover records that
 *    predate it.
 */
import { normalizeSearchText } from "./libraryText";
import type { CatalogGame } from "./types";

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
  | "has_downloads"
  /**
   * The generic `Co-op` category alone, without the Online/LAN/Split variants.
   * The panel's "Co-op / PvE" branch requires this, while the general `coop`
   * concept accepts any of them: matching an `Online Co-op` game through the
   * generic concept would confirm co-op-over-LAN on online-only evidence.
   */
  | "coop_generic";

/** Steam category ids for player support, as the store reports them. */
const CAPABILITY_NAMES: Record<number, string> = { 1: "Multi-player", 2: "Single-player", 9: "Co-op", 24: "Shared/Split Screen", 36: "Online PvP", 38: "Online Co-op", 39: "Shared/Split Screen Co-op", 48: "LAN Co-op", 49: "PvP" };

/** Both evidence sources, normalized to lowercase text for pattern matching. */
export function capabilityNames(game: CatalogGame): string[] {
  return [...(game.categories ?? []), ...(game.steam_category_ids ?? []).flatMap(id => CAPABILITY_NAMES[id] ? [CAPABILITY_NAMES[id]] : [])].map(normalizeSearchText);
}

/** Community tags, normalized. User opinion, so they enrich but rarely decide. */
export function gameTags(game: CatalogGame): string[] {
  return (game.tags ?? []).map(tag => normalizeSearchText(tag.trim()));
}

export function hasLanCategory(game: CatalogGame): boolean {
  return game.steam_category_ids?.includes(48) === true || (game.categories ?? []).some((category) => (
    normalizeSearchText(category).split(/[^a-z0-9]+/).includes("lan")
  ));
}

/** LAN partnership, by the categories Steam actually reports. */
const LAN_COOP_VALUES = ["LAN Co-op", "Cooperativo em rede local (LAN)", "Cooperativo en LAN"];
const LAN_PVP_VALUES = ["LAN PvP", "JcJ en rede local (LAN)", "JxJ em rede local (LAN)"];

/**
 * Does the game support this capability?
 *
 * One predicate per feature, kept in a map rather than a long if-chain: this is
 * the function the whole gameplay panel depends on, and a chain of thirty
 * comparisons is where wrong answers hide. Multiple names per predicate are the
 * localized variants seen in real records; they are alternatives, not
 * requirements.
 */
export function gameMatchesLibraryFeature(game: CatalogGame, feature: LibraryFeatureKey): boolean {
  // Download availability follows the plugins and changes while the app runs, so
  // it is read live. Everything else is evidence from the catalog record.
  if (feature === "has_downloads") return game.has_downloads === true;
  return gameFeatures(game).has(feature);
}

/**
 * Evidence is computed once per record. Filtering evaluates the same predicates
 * for every game on every filter change; on the 41,000-game catalog that was
 * between 0.8 and 3.4 seconds per change because each call re-normalized the
 * categories and rebuilt the alias sets. The cache entry is dropped if the
 * record's category evidence is replaced.
 */
const FEATURE_CACHE = new WeakMap<CatalogGame, { categories: unknown; ids: unknown; features: Set<LibraryFeatureKey> }>();

function gameFeatures(game: CatalogGame): Set<LibraryFeatureKey> {
  const cached = FEATURE_CACHE.get(game);
  if (cached && cached.categories === game.categories && cached.ids === game.steam_category_ids) return cached.features;
  const features = computeGameFeatures(game);
  FEATURE_CACHE.set(game, { categories: game.categories, ids: game.steam_category_ids, features });
  return features;
}

/** Normalized alias sets, built once per distinct list of names. */
const WANTED_NAMES = new Map<string, Set<string>>();
function wantedNames(values: string[]): Set<string> {
  const key = values.join("\u0000");
  let wanted = WANTED_NAMES.get(key);
  if (!wanted) {
    wanted = new Set(values.map(normalizeSearchText));
    WANTED_NAMES.set(key, wanted);
  }
  return wanted;
}

function computeGameFeatures(game: CatalogGame): Set<LibraryFeatureKey> {
  // Digital and older catalog records can have categories without boolean flags.
  // Categories are Valve's own answer for the game and outrank everything;
  // community tags are user opinion and only fill gaps, which is why they are
  // consulted per concept rather than globally.
  const categories = capabilityNames(game);
  const tags = gameTags(game);
  const has = (...names: string[]) => categories.some(category => names.some(name => category.includes(name)));
  const hasTag = (...names: string[]) => tags.some(tag => names.includes(tag));
  /**
   * Exact match against a full catalog value. This is the language-independent
   * rule: every known alias of a concept is listed, and a value that is not on a
   * list is unknown rather than guessed. Substring matching is what made
   * `Online Co-op` look like generic co-op, and what made `LAN PvP` count as
   * `LAN Co-op`.
   */
  const hasAny = (...values: string[]) => {
    const wanted = wantedNames(values);
    return categories.some(category => wanted.has(category));
  };

  // Steam's co-op categories, in every spelling the catalog contains. PvE has no
  // category of its own (measured: 0 games) and only exists as a tag, so it
  // answers together with Co-op or the option would filter nothing.
  const coopGeneric = game.coop === true || hasAny("Co-op", "Cooperativo", "Кооперативна гра");
  const onlineCoop = game.online_coop === true
    || hasAny("Online Co-op", "Cooperativo en línea", "Cooperativo online", "Мережева кооперативна гра");
  const lanCoop = hasAny(...LAN_COOP_VALUES);
  const screenCoop = game.local_coop === true
    || hasAny("Shared/Split Screen Co-op", "Coop. a pantalla (com)partida", "Cooperativo em tela dividida/compartilhada");
  /**
   * Categories and flags only, never tags. A community tag is user opinion, so it
   * cannot satisfy a required criterion; tags stay searchable as text and are
   * what the user will later be able to add per game.
   */
  const coop = () => coopGeneric || onlineCoop || lanCoop || screenCoop;
  /** The generic category on its own, for the panel's Co-op branch. */
  const coopGenericOnly = () => coopGeneric;

  // Shared/Split Screen is one capability under two names: playing together on
  // one screen. Split-screen-only and shared-screen-only mean the same thing here.
  const shared = game.shared_split_screen === true
    || hasAny("Shared/Split Screen", "Pantalla partida/compartida", "Tela compartilhada/dividida", "Geteilter Bildschirm");
  const lanPvp = hasAny(...LAN_PVP_VALUES);
  const screenPvp = hasAny("Shared/Split Screen PvP");
  const onlinePvp = hasAny("Online PvP", "JcJ en línea", "Online-PvP", "Гравець проти гравця в мережі");
  // PvP includes its connection variants: `LAN PvP` and `Online PvP` are PvP over
  // a link, and the link is a separate concept. Exact matching only on the bare
  // value would drop them, which is a capability regression.
  const pvp = () => game.pvp === true || lanPvp || onlinePvp || screenPvp
    || hasAny("PvP", "JcJ", "JxJ", "Гравець проти гравця");

  /**
   * LAN, as its own concept.
   *
   * Deliberately NOT a token search for "lan": that would make `LAN PvP` satisfy
   * a generic LAN requirement, so `Co-op + LAN` would return a game with
   * `Online Co-op` and `LAN PvP` — two separate facts, neither of them co-op over
   * LAN. Only Steam's LAN categories count.
   */
  const lanAny = () => lanCoop || lanPvp;
  const onlineAny = () => onlineCoop || onlinePvp;
  const localAny = () => shared || screenCoop || screenPvp;
  const mmo = () => game.mmo === true
    || hasAny("MMO", "Multijugador masivo", "Massively Multiplayer");

  // Any multiplayer signal at all, including the generic `Multi-player` category
  // that carries no mode detail.
  const multiplayerAny = () => game.multiplayer === true
    || hasAny("Multi-player", "Multijugador", "Multijoueur", "Multigiocatore", "Mehrspieler",
      "Wieloosobowa", "Multijogador", "多人", "Багатокористувацька гра")
    || coop() || pvp() || mmo() || lanAny() || onlineAny() || localAny();
  /**
   * Capability only: does the game offer a single-player mode? Supporting both
   * modes is normal (Stardew Valley, Battlefield 6), so this stays true for them.
   * The exclusive reading implied by the label "Solo un jugador" is a filtering
   * decision and lives in the filter matcher, not here.
   */
  const singlePlayerSupport = () => game.single_player === true
    || hasAny("Single-player", "Un jugador", "Solo", "Einzelspieler", "Um jogador", "单人");
  const predicates: Record<LibraryFeatureKey, () => boolean> = {
    has_downloads: () => game.has_downloads === true,
    // A requirement per concept, never a same-category assertion: "Co-op + LAN"
    // means the game has co-op and has LAN, and a `LAN Co-op` satisfies both.
    lan: lanAny,
    // "Co-op over LAN" specifically: the combined category, not merely a game
    // that has co-op somewhere and LAN somewhere. The panel's tree does not use
    // this predicate — there the two are independent requirements — but a caller
    // asking for the exact pairing needs the exact evidence.
    coop_lan: () => lanCoop,
    multiplayer_lan: lanAny,
    online_multiplayer: onlineAny,
    local_multiplayer: localAny,
    single_player: singlePlayerSupport,
    multiplayer: multiplayerAny,
    coop,
    coop_generic: coopGenericOnly,
    online_coop: () => onlineCoop,
    local_coop: () => screenCoop,
    shared_split_screen: () => shared,
    mmo,
    cross_platform: () => hasAny("Cross-Platform Multiplayer", "Multijugador multiplataforma",
      "Multijogador entre plataformas", "Кросплатформова гра"),
    pve: coop,
    pvp,
  };
  const matched = new Set<LibraryFeatureKey>();
  for (const key of Object.keys(predicates) as LibraryFeatureKey[]) {
    if (key !== "has_downloads" && predicates[key]()) matched.add(key);
  }
  return matched;
}
