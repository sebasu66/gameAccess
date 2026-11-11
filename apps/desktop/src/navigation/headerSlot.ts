/**
 * Where the content header (§4.3) puts the one game search: the header hands its slot here and the catalog panel,
 * which owns the search and its state, draws the box into it. No slot, no box in the header.
 */
import { useSyncExternalStore } from "react";

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setHeaderSearchSlot(next: HTMLElement | null): void {
  if (slot === next) return;
  slot = next;
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useHeaderSearchSlot = () => useSyncExternalStore(subscribe, () => slot, () => null);

/** Which kind of header each section shows: the game search, a search over what is on screen, or a summary. */
export const GAME_SEARCH_SECTIONS: readonly string[] = ["explore", "newGames", "play", "manager"];
export const PAGE_SEARCH_SECTIONS: readonly string[] = ["support", "general", "appearance", "plugins", "parental"];
export type HeaderKind = "games" | "page" | "summary";
export const headerKind = (section: string): HeaderKind =>
  GAME_SEARCH_SECTIONS.includes(section) ? "games" : PAGE_SEARCH_SECTIONS.includes(section) ? "page" : "summary";

/** Blocks a search over the screen can hide: settings groups and fields, help topics. */
export const PAGE_SEARCH_BLOCKS = ".ga-settings-group, fieldset, .ga-rail-field, .ga-help-topic";

/** Accent- and case-free text, the way the game search compares names. */
export const plainText = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Shows only the blocks under `root` whose text has every word of `query`; returns how many stayed. */
export function filterBlocks(root: ParentNode, query: string, hiddenClass = "ga-nav-filtered"): number {
  const words = plainText(query.trim()).split(/\s+/).filter(Boolean);
  let shown = 0;
  root.querySelectorAll<HTMLElement>(PAGE_SEARCH_BLOCKS).forEach(block => {
    const text = plainText(block.textContent ?? "");
    const match = words.every(word => text.includes(word));
    block.classList.toggle(hiddenClass, !match);
    if (match && words.length && block instanceof HTMLDetailsElement) block.open = true;
    if (match) shown += 1;
  });
  return shown;
}
