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

export function findLibraryLetter(games: CatalogGame[], key: string, selectedIndex: number): number {
  if (!/^\p{L}$/u.test(key)) return -1;
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
  for (let offset = 1; offset <= games.length; offset += 1) {
    const index = (selectedIndex + offset + games.length) % games.length;
    if (normalize(games[index].name.trim()).startsWith(normalize(key))) return index;
  }
  return -1;
}
