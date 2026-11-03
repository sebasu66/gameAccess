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

/**
 * Why a search leaves out games another source finds: for each game, which single criterion keeps it out (the search
 * is run again without that criterion, only over those games), or that the catalog does not have it.
 */
export async function explainMissing({ query = "", filters = {}, appIds }) {
  const [search, params, cache] = await Promise.all([
    import("/src/librarySearch.ts"), import("/src/catalogFilterParams.ts"), import("/src/catalogCache.ts"),
  ]);
  const names = await params.loadCatalogGenreNames();
  const chosen = { ...search.defaultLibraryFilters(), ...filters };
  const run = async (text, wanted) => {
    const sent = { ...params.catalogParamsFromFilters(text, wanted, names), app_ids: appIds, limit: appIds.length };
    return new Set((await cache.queryCatalogCache(sent)).items.map(game => game.app_id));
  };
  const known = await cache.queryCatalogCache({ app_ids: appIds, limit: appIds.length });
  const games = new Map(known.items.map(game => [game.app_id, game]));
  const without = {
    query: () => run("", chosen),
    genre: () => run(query, { ...chosen, genres: [] }),
    players: () => run(query, { ...chosen, features: [] }),
    score: () => run(query, { ...chosen, minReviewScore: undefined }),
    date: () => run(query, { ...chosen, maxAgeDays: undefined, releaseYearFrom: undefined, releaseYearTo: undefined }),
  };
  const found = {};
  for (const [criterion, again] of Object.entries(without)) found[criterion] = await again();
  return appIds.map(appId => {
    const game = games.get(appId);
    if (!game) return { app_id: appId, reasons: ["not in the catalog"] };
    const reasons = Object.keys(without).filter(criterion => found[criterion].has(appId));
    return {
      app_id: appId, name: game.name, reasons: reasons.length ? reasons : ["more than one criterion"],
      rating: game.steam_review_score ?? null, reviews: game.steam_review_count ?? null, release_date: game.release_date ?? null,
      genres: game.genres ?? [], categories: (game.categories ?? []).filter(name => /screen|pantalla|co-?op|multi/i.test(name)),
    };
  });
}
