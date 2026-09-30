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
  | "lan"
  | "shared_split_screen"
  | "mmo"
  | "pvp";

export interface LibrarySearchFilters {
  genres: string[];
  categories: string[];
  features: LibraryFeatureKey[];
}

export const EMPTY_LIBRARY_FILTERS: LibrarySearchFilters = {
  genres: [],
  categories: [],
  features: [],
};

export const LIBRARY_FEATURE_OPTIONS: { key: LibraryFeatureKey; label: string }[] = [
  { key: "single_player", label: "Un jugador" },
  { key: "multiplayer", label: "Multijugador" },
  { key: "online_multiplayer", label: "Multijugador online" },
  { key: "local_multiplayer", label: "Multijugador local" },
  { key: "coop", label: "Cooperativo" },
  { key: "online_coop", label: "Cooperativo en línea" },
  { key: "local_coop", label: "Cooperativo local" },
  { key: "lan", label: "LAN" },
  { key: "shared_split_screen", label: "Pantalla dividida / compartida" },
  { key: "mmo", label: "MMO" },
  { key: "pvp", label: "JcJ / PvP" },
];

export interface LibrarySearchFacets {
  genres: string[];
  categories: string[];
  features: LibraryFeatureKey[];
}

function hasLanCategory(game: CatalogGame): boolean {
  return (game.categories ?? []).some((category) => (
    normalizeSearchText(category).split(/[^a-z0-9]+/).includes("lan")
  ));
}

export function gameMatchesLibraryFeature(game: CatalogGame, feature: LibraryFeatureKey): boolean {
  if (feature === "lan") return hasLanCategory(game);
  if (feature === "online_multiplayer") {
    return Boolean(
      game.online_coop === true
      || (game.categories ?? []).some((category) => {
        const value = normalizeSearchText(category);
        return value.includes("jcj en linea")
          || value.includes("online pvp")
          || value.includes("multijugador en linea")
          || value.includes("online multiplayer");
      }),
    );
  }
  if (feature === "local_multiplayer") {
    return Boolean(
      game.local_coop === true
      || game.shared_split_screen === true
      || hasLanCategory(game)
      || (game.categories ?? []).some((category) => {
        const value = normalizeSearchText(category);
        return value.includes("local multiplayer")
          || value.includes("multijugador local");
      }),
    );
  }
  return game[feature] === true;
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

    const hasFacetFilters = filters.genres.length || filters.features.length;
    if (hasFacetFilters) {
      const matchesGenre = filters.genres.some((genre) => game.genres?.includes(genre));
      const matchesFeature = filters.features.some((feature) => gameMatchesLibraryFeature(game, feature));
      if (!matchesGenre && !matchesFeature) return false;
    }
    return true;
  });
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
