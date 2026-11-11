import { useSyncExternalStore } from "react";
import type { AppScreen } from "../appScreen";
import type { GameArea } from "../gameArea";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";

/**
 * The section chosen in each mode of the new shell (RN2), and which mode the Home screen hosts: Game Access (news,
 * guide, account, subscription, help) or the Catalog sections that still live there (AI suggestions, new games).
 */
type Selection = Record<NavigationModeId, string> & { homeMode: HomeMode };
export type HomeMode = "gameAccess" | "catalog";

/** Catalog sections drawn by the Home screen until they get screens of their own (AiPicks, NewsPanel). */
export const CATALOG_ON_HOME = ["aiSuggestions", "newGames"] as const;
const onHome = (section: string) => (CATALOG_ON_HOME as readonly string[]).includes(section);

const initial = (): Selection => ({ ...(Object.fromEntries(NAVIGATION.map(mode => [mode.id, mode.sections[0].id])) as Record<NavigationModeId, string>), homeMode: "gameAccess" });
let selection: Selection = initial();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const getNavigationSelection = () => selection;
export const useNavigationSelection = () => useSyncExternalStore(subscribe, getNavigationSelection, getNavigationSelection);

/** Chooses a section of a mode; a section shown on Home also makes Home host its mode. False if the mode has no such section. */
export function selectNavigationSection(mode: NavigationModeId, section: string): boolean {
  if (!NAVIGATION.find(item => item.id === mode)?.sections.some(item => item.id === section)) return false;
  const homeMode: HomeMode = mode === "gameAccess" ? "gameAccess" : mode === "catalog" && onHome(section) ? "catalog" : selection.homeMode;
  if (selection[mode] === section && selection.homeMode === homeMode) return true;
  selection = { ...selection, [mode]: section, homeMode };
  listeners.forEach(listener => listener());
  return true;
}

/** Back to the first section of every mode (tests). */
export function resetNavigationSelection(): void {
  selection = initial();
  listeners.forEach(listener => listener());
}

/** The mode on screen: Home is Game Access or the Catalog it hosts, Parental is part of Settings, the games say their area. */
export function shellMode(screen: AppScreen, area: GameArea | undefined, homeMode: HomeMode): NavigationModeId {
  if (screen === "home") return homeMode;
  if (screen === "kids" || screen === "settings") return "settings";
  return area ?? "catalog";
}

/** Where a news item opens: a batch of new downloads in Catalog › New games, any other in Game Access › News. */
export const newsDestination = (id: string): { mode: NavigationModeId; section: string } =>
  id.startsWith("downloads-") ? { mode: "catalog", section: "newGames" } : { mode: "gameAccess", section: "news" };

/** The tabs of the settings screen each Settings section shows (vault/Rediseño de navegación.md §2). */
export function settingsTabIds(section: string): string[] {
  if (section === "general") return ["games", "steam", "ai", "mcp", "options"];
  if (section === "appearance") return ["style"];
  if (section === "plugins") return ["plugins"];
  return [];
}
