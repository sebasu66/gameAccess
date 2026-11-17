/**
 * Text report of how search, filters and ordering behave on the REAL catalog.
 *
 *   npm run catalog:report
 *
 * Prints the report to the console and writes it to logs/catalog-report.txt, so
 * nobody has to open the app, search by hand or send screenshots. Each check shows
 * the measured number and PASS/FAIL; the command fails if any check fails. The
 * same invariants run as assertions in catalogRealData.test.ts during `npm test`;
 * this report is for reading the numbers.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { loadRealCatalog } from "./catalogFixture";
import { genreConceptIds, genreLabel } from "./libraryGenres";
import { buildLibraryCollection, popularityValue, releaseDateValue, reviewScoreRank } from "./librarySections";
import { filterLibraryGames, gameIsSoftware, getLibrarySearchFacets, parseReleaseDate } from "./librarySearch";
import type { CatalogGame } from "./types";

const OUT = new URL("../logs/catalog-report.txt", import.meta.url);
const fmt = (value: number) => value.toLocaleString("es-AR");
const pct = (part: number, whole: number) => `${((100 * part) / Math.max(1, whole)).toFixed(1)}%`;

it("catalog report", async () => {
  const loaded = await loadRealCatalog();
  if (!loaded) {
    console.log("catalog report skipped: this Node has no node:sqlite (needs Node 22.5+).");
    return;
  }
  const { games, revision } = loaded;
  const base = { genres: [], categories: [], features: [], software: false };
  const count = (filters: object = {}, query = "") => filterLibraryGames(games, query, { ...base, ...filters } as never).length;
  const lines: string[] = [];
  const failures: string[] = [];
  const out = (line = "") => lines.push(line);
  const check = (label: string, value: string, ok: boolean) => {
    out(`  [${ok ? "PASS" : "FAIL"}] ${label.padEnd(58)} ${value}`);
    if (!ok) failures.push(label);
  };
  const section = (title: string) => { out(); out(`== ${title} ==`); };
  const table = (rows: CatalogGame[], value: (game: CatalogGame) => string, limit = 10) =>
    rows.slice(0, limit).forEach((game, index) => out(`  ${String(index + 1).padStart(2)}. ${game.name.slice(0, 44).padEnd(44)} ${value(game)}`));

  out(`GameAccess catalog report - revision ${revision} - ${fmt(games.length)} games`);

  section("Data coverage");
  const share = (label: string, have: number) => out(`  ${label.padEnd(28)} ${fmt(have).padStart(7)}  ${pct(have, games.length)}`);
  share("release date", games.filter(g => (g.release_date ?? "").trim()).length);
  share("release date readable", games.filter(g => parseReleaseDate(g.release_date)).length);
  share("review score", games.filter(g => typeof g.steam_review_score === "number").length);
  share("review count", games.filter(g => (g.steam_review_count ?? 0) > 0).length);
  share("recommendation count", games.filter(g => (g.recommendation_count ?? 0) > 0).length);
  share("genres", games.filter(g => genreConceptIds(g.genres).length > 0).length);
  share("categories (player modes)", games.filter(g => (g.categories ?? []).length > 0).length);
  share("tags", games.filter(g => (g.tags ?? []).length > 0).length);
  const descriptors = games.filter(g => (g.content_descriptorids ?? []).length > 0).length;
  share("content descriptors", descriptors);
  if (descriptors === 0) out("  NOTE: no game carries content descriptors, so the adult/sexual-content filters have no data in this package.");

  section("Genres (concepts, not Steam text)");
  const facets = getLibrarySearchFacets(games).genres;
  const sizes = facets.map(id => ({ id, n: count({ genres: [id] }) })).sort((a, b) => b.n - a.n);
  sizes.slice(0, 15).forEach(({ id, n }) => out(`  ${genreLabel(id).padEnd(28)} ${id.padEnd(24)} ${fmt(n).padStart(7)}`));
  const rawValues = new Set(games.flatMap(g => g.genres ?? []));
  check("genre choices offered after mapping", `${facets.length} (from ${rawValues.size} raw values)`, facets.length < rawValues.size && facets.length <= 75);
  check("no genre label offered twice", "", new Set(facets.map(id => genreLabel(id).toLowerCase())).size === facets.length);
  const racing = count({ genres: ["racing"] });
  const racingSpanish = count({ genres: ["Carreras"] });
  check("genre racing", `${fmt(racing)} games`, racing > 1000);
  check("genre 'Carreras' (Spanish spelling) equals racing", `${fmt(racingSpanish)} games`, racingSpanish === racing);
  check("text search 'racing' (name and tags only)", `${fmt(count({}, "racing"))} games`, count({}, "racing") > 100);

  section("Player modes");
  for (const [label, features, floor] of [
    ["single player", ["single_player"], 5000], ["multiplayer", ["multiplayer"], 1000], ["co-op", ["multiplayer", "coop"], 500],
    ["PvP", ["multiplayer", "pvp"], 500], ["online", ["multiplayer", "online_multiplayer"], 500], ["LAN", ["lan"], 100],
    ["split screen", ["shared_split_screen"], 300],
  ] as const) {
    const n = count({ features });
    check(label, `${fmt(n)} games`, n > floor);
  }
  const racingMulti = count({ genres: ["racing"], features: ["multiplayer"] });
  check("racing + multiplayer is a strict intersection", `${fmt(racingMulti)} games`, racingMulti > 0 && racingMulti < racing);

  section("Ordering");
  const sorted = (sort: Parameters<typeof buildLibraryCollection>[5]) => buildLibraryCollection(games, {}, {}, {}, "catalog", sort).games;
  out("  Popularity, top 10:");
  const byPopularity = sorted("steam-popularity");
  table(byPopularity, g => fmt(popularityValue(g)).padStart(10));
  const popularity = byPopularity.slice(0, 200).map(popularityValue);
  check("popularity order is non-increasing", "top 200", popularity.every((v, i) => i === 0 || popularity[i - 1] >= v));
  check("games with popularity data", pct(games.filter(g => popularityValue(g) > 0).length, games.length), games.filter(g => popularityValue(g) > 0).length / games.length > 0.85);
  out("  Review score (adjusted for review count), top 10:");
  const byScore = sorted("steam-review-score");
  table(byScore, g => `${g.steam_review_score}% of ${fmt(g.steam_review_count ?? 0)}`.padStart(22));
  check("score ranking only surfaces well-reviewed games", `min reviews in top 50: ${fmt(Math.min(...byScore.slice(0, 50).map(g => g.steam_review_count ?? 0)))}`,
    byScore.slice(0, 50).every(g => (g.steam_review_count ?? 0) >= 300));
  const ranks = byScore.slice(0, 200).map(reviewScoreRank);
  check("score order is non-increasing", "top 200", ranks.every((v, i) => i === 0 || ranks[i - 1] >= v));
  out("  Release date, newest 10:");
  const byDate = sorted("release-date");
  table(byDate, g => String(g.release_date ?? "").padStart(12));
  const dates = byDate.slice(0, 200).map(g => releaseDateValue(g.release_date));
  check("date order is non-increasing", "top 200", dates.every((v, i) => i === 0 || dates[i - 1] >= v));

  section("Search and bounds");
  check("search 'zelda'", `${fmt(count({}, "zelda"))} games`, count({}, "zelda") > 0);
  check("search ignores accents and case ('CAFÉ' = 'cafe')", `${count({}, "CAFÉ")} = ${count({}, "cafe")}`, count({}, "cafe") > 0 && count({}, "CAFÉ") === count({}, "cafe"));
  check("score >= 80", `${fmt(count({ minReviewScore: 80 }))} games`, count({ minReviewScore: 80 }) > 1000);
  check("released from 2026", `${fmt(count({ releaseYearFrom: 2026 }))} games`, count({ releaseYearFrom: 2026 }) > 5000);
  const software = games.filter(gameIsSoftware).length;
  check("software kept out of a games search", `${software} programs`, count() === games.length - software);

  section("Speed (second pass, after caches are warm)");
  const run = () => buildLibraryCollection(filterLibraryGames(games, "a", { ...base, genres: ["action"], features: ["single_player"] } as never), {}, {}, {}, "catalog", "steam-popularity");
  run();
  const started = performance.now();
  const shown = run().games.length;
  const elapsed = performance.now() - started;
  check("genre + mode + text query + popularity sort", `${elapsed.toFixed(0)} ms for ${fmt(shown)} games`, elapsed < 1500);

  out();
  out(failures.length ? `RESULT: ${failures.length} check(s) FAILED - ${failures.join("; ")}` : "RESULT: all checks passed");
  const text = lines.join("\n");
  console.log("\n" + text + "\n");
  mkdirSync(new URL("../logs/", import.meta.url), { recursive: true });
  writeFileSync(OUT, text + "\n", "utf8");
  if (failures.length) throw new Error(`${failures.length} catalog check(s) failed; see logs/catalog-report.txt`);
}, 120_000);
