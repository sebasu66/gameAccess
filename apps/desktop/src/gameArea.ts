import { useSyncExternalStore } from "react";
import { setAppScreen, useAppScreen } from "./appScreen";
import { closeLibraryManager, openLibraryManager, useLibraryManagerShown } from "./libraryManagerNav";

/**
 * The two areas of the games (Seba, 2026-11-09): the Catalog is about getting new games (the catalog and the Download
 * Manager), the Library about playing and managing the games one has (the library and the Library Manager). A game
 * leaves the Catalog's downloads for the Library only once the Download Manager has installed it.
 * Each area has its sections, chosen from the tabs under the top bar (AreaTabs.tsx). The catalog and the library are
 * views of the games' grid (LibraryRoom); the Download Manager is a screen of its own (DownloadsScreen.tsx).
 */
export type GameArea = "catalog" | "library";
export type GameSection = "catalog" | "downloads" | "play" | "manager";
export const AREA_SECTIONS: Record<GameArea, GameSection[]> = { catalog: ["catalog", "downloads"], library: ["play", "manager"] };

/** Asks the games' grid to show the catalog or the library view (LibraryRoom listens). */
export const REQUEST_GAMES_VIEW_EVENT = "gameaccess:request-games-view";
export type GamesView = "catalog" | "library";

// Which view the games' grid shows: LibraryRoom reports it, the tabs and the rail read it.
let view: GamesView = "catalog";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setGamesView(next: GamesView): void {
  if (view === next) return;
  view = next;
  listeners.forEach(listener => listener());
}
export const useGamesView = () => useSyncExternalStore(subscribe, () => view, () => view);

function showView(next: GamesView): void {
  setAppScreen("games");
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<{ view: GamesView }>(REQUEST_GAMES_VIEW_EVENT, { detail: { view: next } }));
}

/** Opens a section of an area; the area alone opens its first section. */
export function openSection(section: GameSection, appId?: number): void {
  if (section === "downloads") { setAppScreen("downloads"); return; }
  if (section === "manager") { openLibraryManager(appId); return; }
  closeLibraryManager();
  showView(section === "catalog" ? "catalog" : "library");
}
export const openArea = (area: GameArea) => openSection(AREA_SECTIONS[area][0]);

/** The area and section on screen, or null outside the games (Home, Parental, Settings). */
export function useGameSection(): { area: GameArea; section: GameSection } | null {
  const screen = useAppScreen();
  const manager = useLibraryManagerShown();
  const current = useGamesView();
  if (screen === "downloads") return { area: "catalog", section: "downloads" };
  if (screen !== "games") return null;
  if (current === "catalog") return { area: "catalog", section: "catalog" };
  return { area: "library", section: manager ? "manager" : "play" };
}
