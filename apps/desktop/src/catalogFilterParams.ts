import type { CatalogQueryParams } from "./catalogCache";
import type { LibrarySearchFilters } from "./librarySearch";

/** The catalog query (SQLite) for a search text and the filters chosen in the filter dialog. */
export function catalogParamsFromFilters(query: string, filters: LibrarySearchFilters): CatalogQueryParams {
  const features = filters.features?.filter(feature => feature !== "has_downloads");
  return {
    query: query.trim(),
    genres: filters.genres?.length ? filters.genres : undefined,
    features: features?.length ? features : undefined,
    sources: filters.sources?.length ? filters.sources : undefined,
    has_downloads: filters.features?.includes("has_downloads") ? true : undefined,
    min_rating: filters.minReviewScore,
    max_age_days: filters.maxAgeDays,
    include_recent_unrated: filters.spareUnprovenGames,
  };
}
