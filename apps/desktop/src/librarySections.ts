import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";
import { parseReleaseDate } from "./libraryQuality";
export const SECTION_PREVIEW_SIZE = 16;
export const SECTION_PAGE_SIZE = 40;
export type SectionId = "installed" | "downloads" | "favorites" | "catalog";
export type CatalogSort = "release-date" | "steam-popularity" | "steam-review-score" | "name";
export type LibraryView = "library" | "catalog" | "latest" | "popular" | "top" | "installed" | "favorites";
export interface LibrarySection { id: SectionId; title: string; description?: string; emptyMessage?: string; games: CatalogGame[] }
const titleOrder = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * Sort key for a release date: milliseconds since the epoch, 0 when unknown.
 * Delegates to the one shared parser so sorting and the year filter agree on
 * which dates are readable; unknown dates sort after every known one in the
 * newest-first order and are never mistaken for old releases.
 */
export function releaseDateValue(value?: string | null): number {
  return parseReleaseDate(value)?.getTime() ?? 0;
}

/**
 * How popular a game is, on one scale.
 *
 * Steam's `recommendation_count` is present for only a few hundred games of the
 * 41,000 in the published catalog (0.6%), so sorting on it alone left the rest in
 * alphabetical order. `steam_review_count` covers about 90% and sits on a
 * comparable scale (No Man's Sky: 313,971 recommendations, 352,858 reviews), so it
 * stands in whenever the recommendation count is missing. A game with neither is
 * 0, which is "unknown", not "unpopular".
 */
export function popularityValue(game: CatalogGame): number {
  const recommendations = game.recommendation_count;
  if (typeof recommendations === "number" && Number.isFinite(recommendations) && recommendations > 0) return recommendations;
  const reviews = game.steam_review_count;
  return typeof reviews === "number" && Number.isFinite(reviews) && reviews > 0 ? reviews : 0;
}

export function hasPopularityData(games: readonly CatalogGame[]): boolean {
  return games.some(game => popularityValue(game) > 0);
}

/** Reviews it takes for a game's own score to outweigh the prior. */
const REVIEW_PRIOR_WEIGHT = 100;
/** Prior score: Steam's threshold for "Mostly Positive". */
const REVIEW_PRIOR_SCORE = 70;

/**
 * Review score for ranking, or -1 when there is no usable score.
 *
 * The raw percentage is not comparable across review counts: 3 positive reviews
 * out of 3 is 100% and would outrank 50,000 reviews at 95%. The score is pulled
 * toward the prior in proportion to how few reviews back it, so a few reviews
 * barely move it and thousands decide it. The displayed score is untouched; this
 * is only the order.
 */
export function reviewScoreRank(game: CatalogGame): number {
  const score = game.steam_review_score;
  const count = game.steam_review_count ?? 0;
  if (typeof score !== "number" || !Number.isFinite(score) || count <= 0) return -1;
  return (count * score + REVIEW_PRIOR_WEIGHT * REVIEW_PRIOR_SCORE) / (count + REVIEW_PRIOR_WEIGHT);
}

export function compareCatalogGames(a: CatalogGame, b: CatalogGame, sort: CatalogSort): number {
  const title = () => titleOrder.compare(a.name, b.name) || a.id - b.id;
  if (sort === "release-date") return releaseDateValue(b.release_date) - releaseDateValue(a.release_date) || title();
  if (sort === "steam-popularity") return popularityValue(b) - popularityValue(a) || title();
  if (sort === "steam-review-score") {
    return reviewScoreRank(b) - reviewScoreRank(a) || (b.steam_review_count ?? 0) - (a.steam_review_count ?? 0) || title();
  }
  return title();
}

export function buildLibraryCollection(
  games: CatalogGame[],
  downloads: Record<number, ManagedDownloadStatus>,
  preferences: Record<number, 1 | -1> = {},
  history: Record<number, number> = {},
  view: LibraryView = "popular",
  catalogSort: CatalogSort = "steam-popularity",
  libraryIds: ReadonlySet<number> = new Set(),
): LibrarySection {
  const hasRecommendations = hasPopularityData(games);
  const hasSteamReviewData = games.some(game => typeof game.steam_review_score === "number" && (game.steam_review_count ?? 0) > 0);
  const effectiveSort = catalogSort === "steam-popularity" && !hasRecommendations ? "name" : catalogSort;
  const titles: Record<LibraryView, string> = {
    library: "Biblioteca",
    catalog: catalogSort === "release-date"
      ? "Catálogo · lanzamientos recientes"
      : catalogSort === "steam-popularity"
        ? "Catálogo · popularidad en Steam"
        : catalogSort === "steam-review-score"
          ? "Catálogo · puntuación de Steam"
          : "Catálogo · A–Z",
    popular: effectiveSort === "steam-popularity" ? "Populares · Steam global" : "Populares · A–Z",
    latest: "Latest · lanzamientos recientes",
    top: "Top · mejor valorados en Steam",
    installed: "Instalados",
    favorites: "Favoritos",
  };
  const descriptions: Record<LibraryView, string> = {
    library: "Tus juegos, instalados o sin instalar.",
    catalog: catalogSort === "release-date"
      ? "Todos los juegos ordenados por fecha de lanzamiento, del más reciente al más antiguo."
      : catalogSort === "steam-popularity"
        ? hasRecommendations ? "Todos los juegos ordenados por popularidad en Steam (recomendaciones o cantidad de reseñas)." : "Steam no proporcionó datos de popularidad para estos juegos; se ordenan por título."
        : catalogSort === "steam-review-score"
          ? hasSteamReviewData ? "Todos los juegos ordenados por puntuación de reseñas de Steam, ajustada por la cantidad de reseñas." : "Todavía no hay puntuaciones de reseñas de Steam; los juegos se ordenan por título."
          : "Todos los juegos disponibles, ordenados alfabéticamente.",
    popular: effectiveSort === "steam-popularity"
      ? "Ordenados por popularidad en Steam (recomendaciones o cantidad de reseñas)."
      : "Ordenados alfabéticamente.",
    latest: "Ordenados por fecha de lanzamiento de Steam, más recientes primero.",
    top: hasSteamReviewData ? "Ordenados por porcentaje de reseñas positivas de Steam, ajustado por la cantidad de reseñas." : "El ranking Top necesita datos de reseñas de Steam que todavía no llegan en el catálogo.",
    installed: "Juegos instalados o preparados en este dispositivo.",
    favorites: "Tus juegos favoritos.",
  };
  const collection = games.filter(game => {
    if (view === "library") return libraryIds.has(game.app_id ?? game.id);
    if (view === "installed") {
      const state = gameStateManager.resolve(game.app_id ? downloads[game.app_id] : undefined);
      return state.installed || state.prepared || preferences[game.id] === 1;
    }
    if (view === "favorites") return preferences[game.id] === 1;
    if (view === "top") return typeof game.steam_review_score === "number" && (game.steam_review_count ?? 0) > 0;
    return true;
  });
  collection.sort((a, b) => {
    const favoriteOrder = Number(preferences[b.id] === 1) - Number(preferences[a.id] === 1);
    if (favoriteOrder) return favoriteOrder;
    // Catalog and Library share the visible sort selector; history must not
    // silently override it. Favorites are partitioned before this comparator.
    const sort = view === "latest" ? "release-date" : view === "top" ? "steam-review-score" : view === "popular" ? effectiveSort : catalogSort;
    return compareCatalogGames(a, b, sort);
  });
  return { id: "catalog", title: titles[view], description: descriptions[view], emptyMessage: view === "top" && !hasSteamReviewData ? "Steam todavía no proporcionó reseñas para calcular este ranking." : undefined, games: collection };
}
export function buildLibrarySections(games: CatalogGame[], downloads: Record<number, ManagedDownloadStatus>, preferences: Record<number, 1 | -1> = {}, history: Record<number, number> = {}, catalogSort: CatalogSort = "steam-popularity"): LibrarySection[] {
  const hasSteamPopularity = hasPopularityData(games);
  const effectiveSort = catalogSort === "steam-popularity" && !hasSteamPopularity ? "name" : catalogSort;
  const catalogPresentation = effectiveSort === "steam-popularity"
    ? { title: "Catálogo", description: "Ordenados por popularidad global en Steam (recomendaciones o cantidad de reseñas); no es un ranking regional de Argentina." }
    : catalogSort === "release-date"
      ? { title: "Catálogo", description: "Ordenados por fecha de lanzamiento, del más reciente al más antiguo." }
      : catalogSort === "steam-review-score"
        ? { title: "Catálogo", description: "Ordenados por puntuación de reseñas de Steam." }
        : { title: "Catálogo", description: catalogSort === "steam-popularity" ? "No hay datos de recomendaciones para estos juegos; se muestran por título." : "Ordenados alfabéticamente por título." };
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
    if (section.id === "catalog") section.games.sort((a, b) => compareCatalogGames(a, b, effectiveSort));
  }
  return sections.filter(section => section.id === "installed" || section.games.length > 0);
}
export function sectionPage(games: CatalogGame[], expanded: boolean, page: number) {
  const lastPage = Math.max(0, Math.ceil(games.length / SECTION_PAGE_SIZE) - 1);
  const safePage = Math.max(0, Math.min(page, lastPage));
  const start = expanded ? safePage * SECTION_PAGE_SIZE : 0;
  return { games: games.slice(start, start + (expanded ? SECTION_PAGE_SIZE : SECTION_PREVIEW_SIZE)), start, page: safePage, lastPage };
}
