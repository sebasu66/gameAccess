/**
 * The catalog through the app's own functions, with the parameters the interface builds: the racing search of the
 * Steam comparison (same screen, 70 %, last 5 years), sorting, and the taste profile that likes and dislikes build.
 */
import assert from "node:assert/strict";

const FIVE_YEARS = 5 * 365;
const RACING = { genres: ["Racing"], features: ["multiplayer", "shared_split_screen"], minReviewScore: 70, maxAgeDays: FIVE_YEARS, spareUnprovenGames: false };

export async function run(call, log) {
  // The window has to have loaded the frontend before its modules answer.
  await call("ga_wait", { target: { role: "button", name: "Juegos", exact: true }, ms: 60000 });

  const rated = await call("ga_catalog_search", { filters: RACING });
  log("racing, same screen, ≥ 70 %, 5 years:", rated.total);
  assert.ok(rated.params.genres.includes("Racing"), "the genre concept becomes its stored spellings");
  assert.deepEqual(rated.params.features, ["multiplayer", "shared_split_screen"]);
  assert.equal(rated.params.min_rating, 70);
  assert.equal(rated.params.max_age_days, FIVE_YEARS);
  assert.ok(rated.total > 0 && rated.total === rated.games.length, "every game fits in one page");
  assert.ok(rated.games.every(game => game.rating !== null), "without keeping unrated games, every game has a score");
  // Unset means "do not keep them", as after "Limpiar todo" and a new score (catalogFilterParams.ts).
  const unset = await call("ga_catalog_search", { filters: { ...RACING, spareUnprovenGames: undefined } });
  assert.equal(unset.total, rated.total, "an unset spareUnprovenGames does not bring unrated games back");
  const oldest = new Date(Date.now() - FIVE_YEARS * 86400000);
  for (const game of rated.games) {
    assert.ok(game.rating >= 70, `${game.name} has ${game.rating} %`);
    if (game.release_date && !Number.isNaN(Date.parse(game.release_date))) {
      assert.ok(new Date(game.release_date) >= oldest, `${game.name} came out ${game.release_date}`);
    }
  }

  // As the catalog opens: unrated games are kept.
  const spared = await call("ga_catalog_search", { filters: { ...RACING, spareUnprovenGames: true } });
  log("… keeping unrated games:", spared.total);
  assert.ok(spared.total > rated.total, "keeping unrated games adds some");
  const unrated = spared.games.filter(game => game.rating === null);
  log("   unrated among them:", unrated.length, unrated.slice(0, 5).map(game => `${game.name} (${game.release_date ?? "no date"})`).join(", "));

  // The filter dialog counts with a one-game query; the grid shows the whole list. Both must agree.
  const counted = await call("ga_module", { module: "catalogCache.ts", export: "queryCatalogCache", args: [{ ...rated.params, limit: 1 }] });
  assert.equal(counted.total, rated.total, "the dialog's count is the grid's total");

  const byScore = await call("ga_catalog_search", { filters: RACING, sort: "steam-review-score" });
  assert.equal(byScore.total, rated.total, "sorting keeps the same games");
  assert.deepEqual(new Set(byScore.games.map(game => game.id)), new Set(rated.games.map(game => game.id)));
  const scores = byScore.games.map(game => game.rating ?? -1);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "sorted by score, best first");
  const byName = await call("ga_catalog_search", { filters: RACING, sort: "name" });
  const names = byName.games.map(game => game.name);
  log("first by score:", byScore.games.slice(0, 3).map(game => `${game.name} ${game.rating}`).join(", "), "· by name:", names.slice(0, 3).join(", "));
  assert.notDeepEqual(names, byScore.games.map(game => game.name), "another sort, another order");

  // Likes and dislikes: the profile the catalog uses for "Personalizado" (tasteProfile.ts), from the same games.
  const strategy = await call("ga_catalog_search", { filters: { genres: ["Strategy"], minReviewScore: 70 }, limit: 6 });
  const liked = rated.games.slice(0, 6), disliked = strategy.games.slice(0, 6);
  const known = (await call("ga_module", { module: "catalogCache.ts", export: "queryCatalogCache",
    args: [{ game_ids: [...liked, ...disliked].map(game => game.id), limit: 12 }] })).items;
  const profileFor = ratings => call("ga_module", { module: "tasteProfile.ts", export: "buildTasteProfile", args: [ratings, known, {}] });
  const one = await profileFor({ [liked[0].id]: 1 });
  const ratings = Object.fromEntries([...liked.map(game => [game.id, 1]), ...disliked.map(game => [game.id, -1])]);
  const many = await profileFor(ratings);
  log("profile: 1 like →", Math.round(one.certainty * 100), "% ready", one.ready, "· 6 likes + 6 dislikes →", Math.round(many.certainty * 100), "% ready", many.ready);
  log("   traits:", many.traits.slice(0, 6).map(trait => `${trait.label} ${trait.weight > 0 ? "+" : ""}${trait.weight.toFixed(2)}`).join(", "));
  assert.ok(!one.ready && many.certainty > one.certainty, "more ratings, a more certain profile");
  assert.ok(many.traits.some(trait => trait.weight > 0 && /racing|carreras/i.test(trait.label)), "liking racing games makes racing a liked trait");
}
