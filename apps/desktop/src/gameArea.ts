import { useSyncExternalStore } from "react";
import { setAppScreen, useAppScreen } from "./appScreen";
import { closeLibraryManager, openLibraryManager, useLibraryManagerShown } from "./libraryManagerNav";

/**
 * Catalog is for discovering games; Library is for playing, downloading, and managing them.
 * This hierarchy comes from vault/Rediseño de navegación.md §2. The catalog and play sections are views of
 * LibraryRoom; Downloads has its own screen and Manager its own panel.
 */
export type GameArea = "catalog" | "library";
export type GameSection = "catalog" | "downloads" | "play" | "manager";
export const AREA_SECTIONS: Record<GameArea, GameSection[]> = { catalog: ["catalog"], library: ["play", "downloads", "manager"] };

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
  if (screen === "downloads") return { area: "library", section: "downloads" };
  if (screen !== "games") return null;
  if (current === "catalog") return { area: "catalog", section: "catalog" };
  return { area: "library", section: manager ? "manager" : "play" };
}
