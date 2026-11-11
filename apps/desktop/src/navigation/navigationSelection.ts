import { useSyncExternalStore } from "react";
import type { AppScreen } from "../appScreen";
import type { GameArea } from "../gameArea";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";

/**
 * The section chosen in each mode of the new shell (RN2), and which mode the Home screen hosts: Game Access (news,
 * guide, account, subscription, help) or the Catalog sections that still live there (AI suggestions, new games).
 */
type Selection = Record<NavigationModeId, string> & { homeMode: HomeMode; tabs: Readonly<Record<string, string>> };
/** Development entry point for the RN2 shell while legacy pages are being moved into its content zone. */
export const navigationShellEnabled = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("navigationShell") === "1";

export type HomeMode = "gameAccess" | "catalog";

/** Catalog sections drawn by the Home screen until they get screens of their own (AiPicks, NewsPanel). */
export const CATALOG_ON_HOME = ["aiSuggestions", "newGames"] as const;
const onHome = (section: string) => (CATALOG_ON_HOME as readonly string[]).includes(section);

const initial = (): Selection => ({ ...(Object.fromEntries(NAVIGATION.map(mode => [mode.id, mode.sections[0].id])) as Record<NavigationModeId, string>), homeMode: "gameAccess", tabs: {} });
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

/**
 * The submode tabs (§2) that already have something to show. The others are drawn but cannot be chosen yet: their
 * screens do not have that part (Play › By genre is the decks of RN8; Manager's Space, Freeze, Move and Import, the
 * three parts of Parental controls and Catalog's new games still have one screen for everything).
 */
export const READY_TABS: Readonly<Record<string, readonly string[]>> = {
  newGames: ["downloadable"],
  play: ["recent", "favorites", "alphabetical"],
  downloads: ["active", "queued", "completed"],
  manager: ["games"],
  news: ["release", "announcements"],
  support: ["instructions", "faq", "contact"],
  subscription: ["plan", "account"],
  general: ["games", "steam", "ai", "mcp", "options"],
  appearance: ["style", "details"],
};
export const tabReady = (section: string, tab: string) => READY_TABS[section]?.includes(tab) ?? false;

/** The tab a section shows: the one chosen if it can be shown, otherwise its first that can. */
export function sectionTab(section: string, chosen: Readonly<Record<string, string>> = selection.tabs): string | undefined {
  const tab = chosen[section];
  return tab && tabReady(section, tab) ? tab : READY_TABS[section]?.[0];
}

/** Chooses a submode tab of a section. False if the section has no such tab or it cannot be shown yet. */
export function selectNavigationTab(mode: NavigationModeId, section: string, tab: string): boolean {
  const found = NAVIGATION.find(item => item.id === mode)?.sections.find(item => item.id === section);
  if (!found || !found.tabs.some(item => item.id === tab) || !tabReady(section, tab)) return false;
  if (selection.tabs[section] === tab) return true;
  selection = { ...selection, tabs: { ...selection.tabs, [section]: tab } };
  listeners.forEach(listener => listener());
  return true;
}

/** The tab one section shows, kept up to date. */
export const useSectionTab = (section: string) => sectionTab(section, useNavigationSelection().tabs);

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
  if (section === "appearance") return ["style", "details"];
  if (section === "plugins") return ["plugins"];
  return [];
}

/**
 * The other sections, in the order the panel lists them (§4.2): the chosen one leaves the list for the title, and the
 * one that was the title comes back in the place the chosen one left. Without a usable earlier order, the tree's.
 */
export function sectionListOrder(all: readonly string[], selected: string, previous?: readonly string[]): string[] {
  const rest = all.filter(id => id !== selected);
  if (!previous || previous.length !== rest.length || !previous.every(id => all.includes(id))) return rest;
  if (!previous.includes(selected)) return [...previous];
  const back = all.find(id => id !== selected && !previous.includes(id))!;
  return previous.map(id => id === selected ? back : id);
}
