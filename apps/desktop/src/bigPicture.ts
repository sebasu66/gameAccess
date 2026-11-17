import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";

/**
 * Big picture mode: the library's ready-to-play games only, large, driven with a controller or with the keyboard and
 * mouse (Seba, 2026-11-10: a controller is not required). Panels, the game detail and card menus stay closed while it
 * is on; downloads keep going in the background. LibraryRoom turns it on and off (button, F11, the controller's Menu
 * button; leaving asks first); the rest reads it here, with the way the games are ordered and the search.
 */
let active = false;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export const bigPictureActive = () => active;

export function setBigPictureActive(next: boolean): void {
  if (active === next) return;
  active = next;
  // Every entry starts without a search: the previous one would hide games without saying why.
  if (!next) view = { ...view, query: "" };
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useBigPicture(): boolean {
  return useSyncExternalStore(subscribe, bigPictureActive, () => false);
}

/** How the games are shown: last played first, alphabetical (grouped by letter) or grouped by genre. */
export type BigPictureOrder = "recent" | "name" | "genre";
export const BIG_PICTURE_ORDERS: readonly BigPictureOrder[] = ["recent", "name", "genre"];
/** What drives the mode now: the controller shows the on-screen keyboard and its buttons; keyboard and mouse do not. */
export type BigPictureInput = "pad" | "keyboard";
export interface BigPictureView { order: BigPictureOrder; query: string; input: BigPictureInput }

const ORDER_KEY = "gameaccess:big-picture-order";
function readOrder(): BigPictureOrder {
  try { const saved = localStorage.getItem(ORDER_KEY); if (BIG_PICTURE_ORDERS.includes(saved as BigPictureOrder)) return saved as BigPictureOrder; } catch { /* no storage */ }
  return "recent";
}
let view: BigPictureView = { order: readOrder(), query: "", input: "keyboard" };
const setView = (next: Partial<BigPictureView>) => {
  const merged = { ...view, ...next };
  if (merged.order === view.order && merged.query === view.query && merged.input === view.input) return;
  view = merged;
  notify();
};

export const bigPictureView = () => view;
export function useBigPictureView(): BigPictureView {
  return useSyncExternalStore(subscribe, bigPictureView, () => view);
}
export function setBigPictureOrder(order: BigPictureOrder): void {
  try { localStorage.setItem(ORDER_KEY, order); } catch { /* not remembered, still works */ }
  setView({ order });
}
/** The next (or previous) order, for the controller's Y, LB and RB. */
export function cycleBigPictureOrder(step: 1 | -1 = 1): void {
  const index = BIG_PICTURE_ORDERS.indexOf(view.order);
  setBigPictureOrder(BIG_PICTURE_ORDERS[(index + step + BIG_PICTURE_ORDERS.length) % BIG_PICTURE_ORDERS.length]);
}
export const setBigPictureQuery = (query: string) => setView({ query });
export const setBigPictureInput = (input: BigPictureInput) => setView({ input });

/** Lower case, without accents or symbols: "Pokémon: Edición" finds "pokemon edicion". */
export const searchText = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Every word of the search is in the name. An empty search matches everything. */
export function matchesSearch(name: string, query: string): boolean {
  const words = searchText(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = searchText(name);
  return words.every(word => haystack.includes(word));
}

/**
 * The search filters as it is typed from this many characters on; with fewer, it waits until no key was pressed for
 * SEARCH_IDLE_MS (Seba, 2026-11-10), so one letter does not empty the screen on every press.
 */
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_IDLE_MS = 2000;
export const searchAppliesNow = (text: string) => { const length = text.trim().length; return length === 0 || length >= SEARCH_MIN_CHARS; };

/**
 * Whether a controller is connected. The app asks Windows (the webview lists a controller only after one of its
 * buttons was pressed); in a plain browser the Gamepad API is all there is. Big picture starts in controller mode
 * when there is one, and in keyboard and mouse mode otherwise.
 */
export async function controllerConnected(deps: { native: boolean; ask: () => Promise<number>; pads: () => ArrayLike<Gamepad | null> } = {
  native: hasTauriRuntime(),
  ask: () => invoke<number>("game_controllers_connected"),
  pads: () => navigator.getGamepads?.() ?? [],
}): Promise<boolean> {
  if (Array.from(deps.pads()).some(pad => pad?.connected)) return true;
  if (!deps.native) return false;
  try { return (await deps.ask()) > 0; } catch { return false; }
}
