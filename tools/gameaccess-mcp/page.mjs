/**
 * Functions that run inside the app's window. Playwright sends each one's source to the page, so they cannot use
 * anything from this file: what they need they import from Vite, the same modules the interface runs.
 */

/** Calls an export of the frontend with JSON arguments. */
export async function callModule({ module, name, args }) {
  const loaded = await import(/* @vite-ignore */ `/src/${module}`);
  if (!(name in loaded)) throw new Error(`${module} exports no ${name}.`);
  const value = loaded[name];
  return typeof value === "function" ? await value(...args) : value;
}

/** The catalog screen's query (LibraryRoom.tsx, catalogBase), sent through queryCatalogCache like the grid's. */
export async function catalogSearch({ query = "", filters = {}, initial = false, sort = "steam-popularity", limit = 1000 }) {
  const [search, params, cache, parental] = await Promise.all([
    import("/src/librarySearch.ts"), import("/src/catalogFilterParams.ts"), import("/src/catalogCache.ts"), import("/src/parentalControl.ts"),
  ]);
  const base = initial ? search.INITIAL_CATALOG_FILTERS : search.defaultLibraryFilters();
  const chosen = parental.applyParentalPolicy({ ...base, ...filters });
  const names = await params.loadCatalogGenreNames();
  const sent = {
    ...params.catalogParamsFromFilters(query, chosen, names),
    sort_by: sort,
    sort_direction: sort === "name" ? "asc" : "desc",
    limit,
  };
  const result = await cache.queryCatalogCache(sent);
  return {
    filters: chosen,
    // What reaches catalog_cache_query, after the parental policy queryCatalogCache adds.
    params: cache.withParentalPolicy(sent),
    total: result.total,
    games: result.items.map(game => ({
      id: game.id, app_id: game.app_id, name: game.name, release_date: game.release_date ?? null,
      rating: game.steam_review_score ?? null, reviews: game.steam_review_count ?? null,
    })),
  };
}
