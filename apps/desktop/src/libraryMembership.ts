import { useSyncExternalStore } from "react";
import type { CatalogGame } from "./types";
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
function publish() {
  if (typeof localStorage !== "undefined") localStorage.setItem(LIBRARY_KEY, JSON.stringify(members));
  initialized = true;
  for (const listener of listeners) listener();
}
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
