import { describe, expect, it } from "vitest";
import { buildLibraryCollection, buildLibrarySections, releaseDateValue, sectionPage, type CatalogSort } from "./librarySections";
import { filterLibraryGames } from "./librarySearch";
import type { CatalogGame } from "./types";
import type { ManagedDownloadStatus } from "./downloadTypes";
const game = (id: number) => ({ id, app_id: id, name: `Game ${id}` }) as CatalogGame;
const status = (id: number, state: ManagedDownloadStatus["state"]) => ({ app_id: id, state, installed: state === "installed" }) as ManagedDownloadStatus;
describe("sectioned catalog", () => {
 it("keeps installed games first, ordered by actual play history, without duplicates", () => {
  const groups = buildLibrarySections([game(1),game(2),game(3),game(4)], {1:status(1,"installed"),2:status(2,"installed"),3:status(3,"frozen")}, {}, {2:200,1:100});
  expect(groups[0].id).toBe("installed"); expect(groups[0].games.map(g=>g.id)).toEqual([2,1]);
  expect(groups.flatMap(g=>g.games).map(g=>g.id)).toEqual([2,1,3,4]);
 });
 it("moves an uninstalled game out of Installed without changing its identity", () => {
  const entry = game(1); const groups=buildLibrarySections([entry],{1:status(1,"not-installed")});
  expect(groups[0].games).toEqual([]); expect(groups[1].games[0]).toBe(entry);
 });
 it("bounds rendering for 11000 games and keeps the last page reachable", () => {
  const games=Array.from({length:11000},(_,i)=>game(i+1));
  expect(sectionPage(games,false,0).games).toHaveLength(16);
  expect(sectionPage(games,true,0).games).toHaveLength(40);
  const last=sectionPage(games,true,9999); expect(last.games.at(-1)?.id).toBe(11000); expect(last.games.length).toBeLessThanOrEqual(40);
 });
});

describe("overview sorting", () => {
 const games = [
  { ...game(1), name: "Title 10", release_date: "5 DIC 2019", recommendation_count: 100, steam_review_score: 80, steam_review_count: 100, online_coop: true },
  { ...game(2), name: "Title 2", release_date: "1 ABR 2024", recommendation_count: 200, steam_review_score: 90, steam_review_count: 50, online_coop: true },
  { ...game(3), name: "Title 3", release_date: "2025-01-01", recommendation_count: 300, steam_review_score: 90, steam_review_count: 200, online_coop: true },
  { ...game(4), name: "Favorite", release_date: null, recommendation_count: null, steam_review_score: null },
  { ...game(5), name: "Unknown", release_date: "Próximamente", steam_review_score: 100, steam_review_count: 0 },
 ];
 const expected: Record<CatalogSort, number[]> = { name: [4, 2, 3, 1, 5], "release-date": [4, 3, 2, 1, 5], "steam-popularity": [4, 3, 2, 1, 5], "steam-review-score": [4, 3, 2, 1, 5] };
 for (const view of ["catalog", "installed"] as const) {
  for (const sort of Object.keys(expected) as CatalogSort[]) {
   it(`${view} respects ${sort} with favorites first`, () => {
    const downloads = { 1: status(1,"installed"), 2: status(2,"installed"), 3: status(3,"installed"), 5: status(5,"installed") };
    expect(buildLibraryCollection(games, downloads, {4:1}, {1:9999}, view, sort).games.map(g => g.id)).toEqual(expected[sort]);
    expect(games.map(g => g.id)).toEqual([1,2,3,4,5]);
   });
  }
 }
 it("preserves favorites-first sorting within search/filter matches", () => {
  const matches = filterLibraryGames(games, "Title", {genres: [], categories: [], features: ["online_coop"]});
  expect(buildLibraryCollection(matches, {}, {1:1}, {}, "catalog", "steam-popularity").games.map(g => g.id)).toEqual([1,3,2]);
 });
 it("parses Spanish Steam dates and sends invalid dates to the end", () => {
  expect(releaseDateValue("5 DIC 2019")).toBe(Date.UTC(2019,11,5));
  expect(releaseDateValue("1 de abril de 2024")).toBe(Date.UTC(2024,3,1));
  expect(releaseDateValue("31 FEB 2024")).toBe(0);
  expect(releaseDateValue("Próximamente")).toBe(0);
 });
});

it("library includes saved uninstalled games and excludes unsaved installed games", () => {
 const owned = {id:701,app_id:71,name:"Saved uninstalled"} as CatalogGame;
 const unsaved = {id:702,app_id:72,name:"Installed only"} as CatalogGame;
 const result = buildLibraryCollection([owned,unsaved],{72:{app_id:72,state:"installed",installed:true} as ManagedDownloadStatus},{},{},"library","name",new Set([71]));
 expect(result.games).toEqual([owned]);
});
