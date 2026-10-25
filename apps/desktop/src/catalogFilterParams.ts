import { useEffect, useState } from "react";
import { getCatalogFacets, type CatalogQueryParams } from "./catalogCache";
import { setKnownSourceNames } from "./catalog/PluginSources";
import { getSteamStoreLanguage } from "./i18n";
import { genreConceptId, genreIsSoftware } from "./libraryGenres";
import { SOFTWARE_GENRES, type LibrarySearchFilters } from "./librarySearch";

/**
 * Genre names exactly as the catalog database stores them ("Racing", "Carreras"…).
 * The filters speak in genre concepts (`racing`); the query needs every spelling.
 */
let genreNames: string[] = [];
let genreNamesRequest: Promise<string[]> | null = null;

export function loadCatalogGenreNames(): Promise<string[]> {
  if (genreNames.length) return Promise.resolve(genreNames);
  genreNamesRequest ??= getCatalogFacets()
    .then(result => {
      genreNames = result.genres ?? [];
      if (Array.isArray(result.sources)) setKnownSourceNames(result.sources);
      return genreNames;
    })
    .catch(() => [])
    .finally(() => { genreNamesRequest = null; });
  return genreNamesRequest;
}

/** Forget the stored genre names (after a catalog update brings new ones). */
export function resetCatalogGenreNames(): void { genreNames = []; }

/** The catalog's genre names, loaded once; re-renders when they arrive. */
export function useCatalogGenreNames(): string[] {
  const [names, setNames] = useState(genreNames);
  useEffect(() => {
    let current = true;
    if (!names.length) void loadCatalogGenreNames().then(loaded => { if (current && loaded.length) setNames(loaded); });
    return () => { current = false; };
  }, [names.length]);
  return names;
}

/** Every stored spelling of the chosen genre concepts. Falls back to the values themselves. */
export function genreNamesFor(values: readonly string[], names: readonly string[]): string[] {
  const wanted = new Set(values.map(genreConceptId).filter((id): id is string => id !== null));
  if (!wanted.size) return [];
  const matched = names.filter(name => { const id = genreConceptId(name); return id !== null && wanted.has(id); });
  return [...new Set([...matched, ...values])];
}

function isSoftwareName(name: string): boolean {
  if (SOFTWARE_GENRES.includes(name)) return true;
  const id = genreConceptId(name);
  return id !== null && genreIsSoftware(id);
}

const nonEmpty = <T,>(values: T[] | undefined): T[] | undefined => values?.length ? values : undefined;

/**
 * The catalog query (SQLite) for a search text and the filters of the filter dialog.
 * Every criterion the dialog offers is sent, so the grid shows exactly what the sentence says.
 */
export function catalogParamsFromFilters(query: string, filters: LibrarySearchFilters, names: readonly string[] = genreNames): CatalogQueryParams {
  const features = filters.features?.filter(feature => feature !== "has_downloads");
  let genres = genreNamesFor(filters.genres ?? [], names);
  let excludeGenres = genreNamesFor(filters.excludeGenres ?? [], names);
  const software = names.filter(isSoftwareName);
  // Programs and games are separate searches.
  if (filters.software === false) excludeGenres = [...new Set([...excludeGenres, ...software, ...SOFTWARE_GENRES])];
  if (filters.software === true) genres = genres.length ? genres : [...new Set([...software, ...SOFTWARE_GENRES])];
  return {
    query: query.trim(),
    language: getSteamStoreLanguage(),
    genres: nonEmpty(genres),
    exclude_genres: nonEmpty(excludeGenres),
    features: nonEmpty(features),
    exclude_features: nonEmpty(filters.excludeFeatures),
    sources: nonEmpty(filters.sources),
    exclude_sources: nonEmpty(filters.excludeSources),
    has_downloads: filters.features?.includes("has_downloads") ? true : undefined,
    content_descriptor_ids: nonEmpty(filters.contentDescriptorIds),
    exclude_content_descriptor_ids: nonEmpty(filters.excludeContentDescriptorIds),
    hide_adult: filters.hideAdult || undefined,
    adult_includes_nudity: filters.adultIncludesNudity || undefined,
    release_year_from: filters.releaseYearFrom,
    release_year_to: filters.releaseYearTo,
    min_rating: filters.minReviewScore,
    max_age_days: filters.maxAgeDays,
    include_recent_unrated: filters.spareUnprovenGames,
    min_review_count: filters.minReviewCount,
  };
}
