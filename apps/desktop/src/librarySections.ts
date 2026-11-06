import { gameStateManager } from "./GameStateManager";
import { translate } from "./i18n";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";
import { parseReleaseDate } from "./libraryQuality";
export const SECTION_PREVIEW_SIZE = 16;
export const SECTION_PAGE_SIZE = 40;
export type SectionId = "installed" | "downloads" | "favorites" | "catalog";
export type CatalogSort = "release-date" | "steam-popularity" | "steam-review-score" | "name";
export type LibraryView = "library" | "catalog" | "latest" | "popular" | "top" | "installed" | "favorites";
export interface LibrarySection { id: SectionId; title: string; description?: string; emptyMessage?: string; games: CatalogGame[]; total?: number; }
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
    library: translate("sectionLibrary"),
    catalog: catalogSort === "release-date"
      ? translate("sectionCatalogRelease")
      : catalogSort === "steam-popularity"
        ? translate("sectionCatalogPopularity")
        : catalogSort === "steam-review-score"
          ? translate("sectionCatalogScore")
          : translate("sectionCatalogAz"),
    popular: effectiveSort === "steam-popularity" ? translate("sectionPopularSteam") : translate("sectionPopularAz"),
    latest: translate("sectionLatest"),
    top: translate("sectionTop"),
    installed: translate("sectionInstalled"),
    favorites: translate("sectionFavorites"),
  };
  const descriptions: Record<LibraryView, string> = {
    library: translate("descLibrary"),
    catalog: catalogSort === "release-date"
      ? translate("descCatalogRelease")
      : catalogSort === "steam-popularity"
        ? hasRecommendations ? translate("descCatalogPopularity") : translate("descCatalogPopularityNoData")
        : catalogSort === "steam-review-score"
          ? hasSteamReviewData ? translate("descCatalogScore") : translate("descCatalogScoreNoData")
          : translate("descCatalogName"),
    popular: effectiveSort === "steam-popularity"
      ? translate("descPopular")
      : translate("descPopularAz"),
    latest: translate("descLatest"),
    top: hasSteamReviewData ? translate("descTopReady") : translate("descTopMissing"),
    installed: translate("descInstalled"),
    favorites: translate("descFavorites"),
  };
  const collection = games.filter(game => {
    if (view === "library") return libraryIds.has(game.app_id ?? game.id);
    if (view === "installed") {
      const state = gameStateManager.resolve(game.app_id ? downloads[game.app_id] : undefined);
      return state.installed || state.prepared;
    }
    if (view === "favorites") return preferences[game.id] === 1;
    if (view === "top") return typeof game.steam_review_score === "number" && (game.steam_review_count ?? 0) > 0;
    return true;
  });
  collection.sort((a, b) => {
    // Catalog and Library share the visible sort selector; neither history nor
    // likes may silently override it.
    const sort = view === "latest" ? "release-date" : view === "top" ? "steam-review-score" : view === "popular" ? effectiveSort : catalogSort;
    return compareCatalogGames(a, b, sort);
  });
  return { id: "catalog", title: titles[view], description: descriptions[view], emptyMessage: view === "top" && !hasSteamReviewData ? "Steam todavía no proporcionó reseñas para calcular este ranking." : view === "library" ? translate("emptyLibraryBody") : undefined, games: collection };
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
    { id: "installed", title: translate("sectionInstalled"), games: [] },
    { id: "downloads", title: "Descargas", games: [] },
    { id: "favorites", title: translate("sectionFavorites"), games: [] },
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
