import type { CatalogGame } from "./types";

export const LIBRARY_SEARCH_EVENT = "gameaccess:library-search-query";

export interface LibrarySearchEventDetail {
  query?: string;
}

export type LibraryFeatureKey =
  | "multiplayer"
  | "coop"
  | "online_coop"
  | "local_coop"
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
  { key: "multiplayer", label: "Multijugador" },
  { key: "coop", label: "Cooperativo" },
  { key: "online_coop", label: "Cooperativo en línea" },
  { key: "local_coop", label: "Cooperativo local" },
  { key: "shared_split_screen", label: "Pantalla dividida" },
  { key: "mmo", label: "MMO" },
  { key: "pvp", label: "JcJ / PvP" },
];

export interface LibrarySearchFacets {
  genres: string[];
  categories: string[];
  features: LibraryFeatureKey[];
}

export function getLibrarySearchFacets(games: CatalogGame[]): LibrarySearchFacets {
  const sortedUnique = (values: string[]) => [...new Set(values.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es"));
  return {
    genres: sortedUnique(games.flatMap((game) => game.genres ?? [])),
    categories: sortedUnique(games.flatMap((game) => game.categories ?? [])),
    features: LIBRARY_FEATURE_OPTIONS
      .filter(({ key }) => games.some((game) => game[key] === true))
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
  if (!terms.length && !filters.genres.length && !filters.categories.length && !filters.features.length) return games;
  return games.filter((game) => {
    if (terms.length) {
      const searchable = normalizeSearchText([
        game.name,
        ...(game.genres ?? []),
        ...(game.categories ?? []),
        ...(game.tags ?? []),
        ...(game.developers ?? []),
        ...(game.publishers ?? []),
        game.short_description ?? "",
      ].join(" "));
      if (!terms.every((term) => searchable.includes(term))) return false;
    }

    if (filters.genres.length && !filters.genres.some((genre) => game.genres?.includes(genre))) return false;
    if (filters.categories.length && !filters.categories.some((category) => game.categories?.includes(category))) return false;
    if (filters.features.some((feature) => game[feature] !== true)) return false;
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
