import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";
export const SECTION_PREVIEW_SIZE = 8;
export const SECTION_PAGE_SIZE = 40;
export type SectionId = "installed" | "downloads" | "stored" | "favorites" | "catalog";
export interface LibrarySection { id: SectionId; title: string; games: CatalogGame[] }
export function buildLibrarySections(games: CatalogGame[], downloads: Record<number, ManagedDownloadStatus>, preferences: Record<number, 1 | -1> = {}, history: Record<number, number> = {}): LibrarySection[] {
  const sections: LibrarySection[] = [
    { id: "installed", title: "Instalados", games: [] },
    { id: "downloads", title: "Descargas", games: [] },
    { id: "stored", title: "Preparados y comprimidos", games: [] },
    { id: "favorites", title: "Favoritos", games: [] },
    { id: "catalog", title: "Catálogo", games: [] },
  ];
  const groups = Object.fromEntries(sections.map(section => [section.id, section]));
  for (const game of games) {
    const state = gameStateManager.resolve(game.app_id ? downloads[game.app_id] : undefined);
    const id = state.transferActive ? "downloads" : state.installed ? "installed" : state.prepared || state.frozen || state.storageBusy ? "stored" : preferences[game.id] === 1 ? "favorites" : "catalog";
    groups[id].games.push(game);
  }
  for (const section of sections) {
    if (section.id === "installed" || section.id === "stored") section.games.sort((a, b) => (history[b.app_id ?? 0] || 0) - (history[a.app_id ?? 0] || 0) || a.name.localeCompare(b.name, "es"));
  }
  return sections.filter(section => section.id === "installed" || section.games.length > 0);
}
export function sectionPage(games: CatalogGame[], expanded: boolean, page: number) {
  const lastPage = Math.max(0, Math.ceil(games.length / SECTION_PAGE_SIZE) - 1);
  const safePage = Math.max(0, Math.min(page, lastPage));
  const start = expanded ? safePage * SECTION_PAGE_SIZE : 0;
  return { games: games.slice(start, start + (expanded ? SECTION_PAGE_SIZE : SECTION_PREVIEW_SIZE)), start, page: safePage, lastPage };
}
