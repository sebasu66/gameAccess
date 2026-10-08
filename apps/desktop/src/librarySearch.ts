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
  | "cross_platform";

export interface LibrarySearchFilters {
  genres: string[];
  categories: string[];
  features: LibraryFeatureKey[];
  includeUncertain?: boolean;
}

export const EMPTY_LIBRARY_FILTERS: LibrarySearchFilters = {
  genres: [],
  categories: [],
  features: [],
};

export const LIBRARY_FEATURE_OPTIONS: { key: LibraryFeatureKey; label: string }[] = [
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
  };
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

export function filterLibraryGames(
  games: CatalogGame[],
  query: string,
  filters: LibrarySearchFilters = EMPTY_LIBRARY_FILTERS,
): CatalogGame[] {
  const terms = normalizeSearchText(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length && !filters.genres.length && !filters.features.length) return games;
  return games.filter((game) => {
    if (terms.length) {
      const searchable = normalizeSearchText([
        game.name,
        ...(game.tags ?? []),
      ].join(" "));
      if (!terms.every((term) => searchable.includes(term))) return false;
    }

    return classifyFilterMatch(game, filters) !== "excluded";
  }).map(game => filters.genres.length || filters.features.length
    ? { ...game, filter_match: classifyFilterMatch(game, filters) as "confirmed" | "possible" }
    : game);
}

// The UI groups capabilities without making them mutually exclusive.
export const GAMEPLAY_FILTER_GROUPS: { id: string; label: string; options: LibraryFeatureKey[] }[] = [
  { id: "players", label: "Jugadores", options: ["single_player", "multiplayer"] },
  { id: "style", label: "Cómo se juega", options: ["coop", "pvp", "pve"] },
  { id: "connection", label: "Dónde se juega", options: ["local_multiplayer", "lan", "online_multiplayer"] },
  { id: "features", label: "Características", options: ["shared_split_screen", "cross_platform", "mmo"] },
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
