import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";
export const SECTION_PREVIEW_SIZE = 16;
export const SECTION_PAGE_SIZE = 40;
export type SectionId = "installed" | "downloads" | "favorites" | "catalog";
export type CatalogSort = "steam-popularity" | "gameaccess-demand" | "name";
export type LibraryView = "catalog" | "popular" | "latest" | "installed" | "favorites" | "categories";
export interface LibrarySection { id: SectionId; title: string; description?: string; games: CatalogGame[] }
export function buildLibraryCollection(
  games: CatalogGame[],
  downloads: Record<number, ManagedDownloadStatus>,
  preferences: Record<number, 1 | -1> = {},
  history: Record<number, number> = {},
  view: LibraryView = "popular",
  catalogSort: CatalogSort = "steam-popularity",
): LibrarySection {
  const hasRecommendations = games.some(game => (game.recommendation_count ?? 0) > 0);
  const effectiveSort = catalogSort === "steam-popularity" && !hasRecommendations ? "name" : catalogSort;
  const titles: Record<LibraryView, string> = {
    catalog: "Catálogo · A–Z",
    popular: effectiveSort === "steam-popularity" ? "Populares · Steam global" : effectiveSort === "gameaccess-demand" ? "Más solicitados en GameAccess" : "Populares · A–Z",
    latest: "Lanzamientos recientes",
    installed: "Instalados",
    favorites: "Favoritos",
    categories: "Categorías",
  };
  const descriptions: Record<LibraryView, string> = {
    catalog: "Todos los juegos disponibles, ordenados alfabéticamente.",
    popular: effectiveSort === "steam-popularity"
      ? "Ordenados por recomendaciones globales de Steam."
      : effectiveSort === "gameaccess-demand"
        ? "Ordenados por sesiones de acceso concedidas en GameAccess."
        : "Ordenados alfabéticamente.",
    latest: "Ordenados por fecha de lanzamiento de Steam, más recientes primero.",
    installed: "Juegos instalados o preparados en este dispositivo.",
    favorites: "Tus juegos favoritos.",
    categories: "Filtrá por géneros, categorías y funciones de Steam.",
  };
  const collection = games.filter(game => {
    if (view === "installed") {
      const state = gameStateManager.resolve(game.app_id ? downloads[game.app_id] : undefined);
      return state.installed || state.prepared;
    }
    if (view === "favorites") return preferences[game.id] === 1;
    return true;
  });
  collection.sort((a, b) => {
    if (view === "installed") return (history[b.app_id ?? 0] || 0) - (history[a.app_id ?? 0] || 0) || a.name.localeCompare(b.name, "es");
    if (view === "popular") {
      if (effectiveSort === "steam-popularity") return (b.recommendation_count ?? 0) - (a.recommendation_count ?? 0) || a.name.localeCompare(b.name, "es");
      if (effectiveSort === "gameaccess-demand") return (b.successful_leases ?? 0) - (a.successful_leases ?? 0) || (b.recommendation_count ?? 0) - (a.recommendation_count ?? 0) || a.name.localeCompare(b.name, "es");
    }
    if (view === "latest") return (Date.parse(b.release_date ?? "") || 0) - (Date.parse(a.release_date ?? "") || 0) || a.name.localeCompare(b.name, "es");
    return a.name.localeCompare(b.name, "es");
  });
  return { id: "catalog", title: titles[view], description: descriptions[view], games: collection };
}
export function buildLibrarySections(games: CatalogGame[], downloads: Record<number, ManagedDownloadStatus>, preferences: Record<number, 1 | -1> = {}, history: Record<number, number> = {}, catalogSort: CatalogSort = "steam-popularity"): LibrarySection[] {
  const hasSteamPopularity = games.some(game => (game.recommendation_count ?? 0) > 0);
  const effectiveSort = catalogSort === "steam-popularity" && !hasSteamPopularity ? "name" : catalogSort;
  const catalogPresentation = effectiveSort === "steam-popularity"
    ? { title: "Más recomendados en Steam", description: "Ordenados por recomendaciones globales de Steam; no es un ranking regional de Argentina." }
    : effectiveSort === "gameaccess-demand"
      ? { title: "Más solicitados en GameAccess", description: "Ordenados por sesiones exitosas en GameAccess." }
      : { title: "Catálogo A–Z", description: catalogSort === "steam-popularity" ? "No hay datos de recomendaciones para estos juegos; se muestran por título." : "Ordenados alfabéticamente por título." };
  const sections: LibrarySection[] = [
    { id: "installed", title: "Instalados", games: [] },
    { id: "downloads", title: "Descargas", games: [] },
    { id: "favorites", title: "Favoritos", games: [] },
    { id: "catalog", ...catalogPresentation, games: [] },
  ];
  const groups = Object.fromEntries(sections.map(section => [section.id, section]));
  for (const game of games) {
    const state = gameStateManager.resolve(game.app_id ? downloads[game.app_id] : undefined);
    const id = state.transferActive ? "downloads" : (state.installed || state.prepared) ? "installed" : preferences[game.id] === 1 ? "favorites" : "catalog";
    groups[id].games.push(game);
  }
  for (const section of sections) {
    if (section.id === "installed") section.games.sort((a, b) => (history[b.app_id ?? 0] || 0) - (history[a.app_id ?? 0] || 0) || a.name.localeCompare(b.name, "es"));
    if (section.id === "catalog") {
      section.games.sort((a, b) => {
        if (effectiveSort === "steam-popularity") return (b.recommendation_count ?? 0) - (a.recommendation_count ?? 0) || a.name.localeCompare(b.name, "es");
        if (effectiveSort === "gameaccess-demand") return (b.successful_leases ?? 0) - (a.successful_leases ?? 0) || (b.recommendation_count ?? 0) - (a.recommendation_count ?? 0) || a.name.localeCompare(b.name, "es");
        return a.name.localeCompare(b.name, "es");
      });
    }
  }
  return sections.filter(section => section.id === "installed" || section.games.length > 0);
}
export function sectionPage(games: CatalogGame[], expanded: boolean, page: number) {
  const lastPage = Math.max(0, Math.ceil(games.length / SECTION_PAGE_SIZE) - 1);
  const safePage = Math.max(0, Math.min(page, lastPage));
  const start = expanded ? safePage * SECTION_PAGE_SIZE : 0;
  return { games: games.slice(start, start + (expanded ? SECTION_PAGE_SIZE : SECTION_PREVIEW_SIZE)), start, page: safePage, lastPage };
}
