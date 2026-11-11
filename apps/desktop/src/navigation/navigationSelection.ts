import { useSyncExternalStore } from "react";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";

type Selection = Record<NavigationModeId, string>;
let selection: Selection = Object.fromEntries(NAVIGATION.map(mode => [mode.id, mode.sections[0].id])) as Selection;
const listeners = new Set<() => void>();

export const getNavigationSelection = () => selection;
export const useNavigationSelection = () => useSyncExternalStore(
  listener => { listeners.add(listener); return () => listeners.delete(listener); },
  getNavigationSelection,
  getNavigationSelection,
);

export function selectNavigationSection(mode: NavigationModeId, section: string): boolean {
  if (!NAVIGATION.find(item => item.id === mode)?.sections.some(item => item.id === section)) return false;
  if (selection[mode] === section) return true;
  selection = { ...selection, [mode]: section };
  listeners.forEach(listener => listener());
  return true;
}
