import type { CatalogGame } from "./types";

export const LIBRARY_SEARCH_EVENT = "gameaccess:library-search-query";

export interface LibrarySearchEventDetail {
  query?: string;
}

export function filterLibraryGames(games: CatalogGame[], query: string): CatalogGame[] {
  const needle = query.trim().toLocaleLowerCase("es");
  if (!needle) return games;
  return games.filter((game) => game.name.toLocaleLowerCase("es").includes(needle));
}
