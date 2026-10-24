import { useSyncExternalStore } from "react";
import type { CatalogGame } from "./types";
import { demoLibraryMembers, uiDemo } from "./devDemo/uiDemo";
export const LIBRARY_KEY = "gameaccess.library.v1";
const listeners = new Set<() => void>();
let members: CatalogGame[] = [];
let initialized = false;
let busy = false;
function load() {
  try {
    const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(LIBRARY_KEY);
    initialized = saved !== null;
    const parsed = JSON.parse(saved || "[]");
    members = Array.isArray(parsed) ? parsed.filter(game => game && Number.isInteger(game.app_id ?? game.id) && game.name) : [];
  } catch { initialized = true; members = []; }
}
load();
// Browser preview (`?uiDemo=1`, dev only): a first run starts with the sample library.
function publish() {
  if (typeof localStorage !== "undefined") localStorage.setItem(LIBRARY_KEY, JSON.stringify(members));
  initialized = true;
  for (const listener of listeners) listener();
}
if (import.meta.env.DEV && uiDemo() && !initialized) { members = demoLibraryMembers(); publish(); }
export const libraryMembership = {
  getGames: () => members,
  has: (game: CatalogGame) => members.some(item => (item.app_id ?? item.id) === (game.app_id ?? game.id)),
  add(game: CatalogGame) {
    if (busy) throw new Error("Espera a que termine la operación de biblioteca.");
    if (this.has(game)) return;
    members = [...members, game]; publish();
  },
  remove(game: CatalogGame) {
    members = members.filter(item => (item.app_id ?? item.id) !== (game.app_id ?? game.id)); publish();
  },
  migrate(games: CatalogGame[]) {
    if (initialized) return;
    members = [...new Map(games.map(game => [game.app_id ?? game.id, game])).values()]; publish();
  },
  isBusy: () => busy,
  setBusy(value: boolean) { busy = value; for (const listener of listeners) listener(); },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export function useLibraryGames() {
  return useSyncExternalStore(libraryMembership.subscribe, libraryMembership.getGames, libraryMembership.getGames);
}
export function useLibraryBusy() {
  return useSyncExternalStore(libraryMembership.subscribe, libraryMembership.isBusy, libraryMembership.isBusy);
}

/** A game that became ready outside the normal download flow (fixed or imported) joins the library; the catalog entry is preferred for its cover and data. */
export function addReadyGameToLibrary(appId: number, name: string, catalog: CatalogGame[] = []) {
  try {
    const game = catalog.find(item => (item.app_id ?? item.id) === appId) ?? ({ id: appId, app_id: appId, name } as CatalogGame);
    libraryMembership.add(game);
  } catch { /* the library is busy: the next refresh keeps the game on disk and it can be added later */ }
}
