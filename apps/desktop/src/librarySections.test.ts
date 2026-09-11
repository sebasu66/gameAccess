import { describe, expect, it } from "vitest";
import { buildLibrarySections, sectionPage } from "./librarySections";
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
  expect(sectionPage(games,false,0).games).toHaveLength(8);
  expect(sectionPage(games,true,0).games).toHaveLength(40);
  const last=sectionPage(games,true,9999); expect(last.games.at(-1)?.id).toBe(11000); expect(last.games.length).toBeLessThanOrEqual(40);
 });
});
