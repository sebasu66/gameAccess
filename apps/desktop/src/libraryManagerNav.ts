import { useSyncExternalStore } from "react";

/** Asks the library to show the Library Manager, on this game's row when given (the processes panel's tasks). */
export const OPEN_LIBRARY_MANAGER_EVENT = "gameaccess:open-library-manager";
/** Asks the library to leave the Library Manager for the games' grid (the frame's Games button). */
export const CLOSE_LIBRARY_MANAGER_EVENT = "gameaccess:close-library-manager";

export function openLibraryManager(appId?: number): void {
  window.dispatchEvent(new CustomEvent<{ appId?: number }>(OPEN_LIBRARY_MANAGER_EVENT, { detail: { appId } }));
}

export function closeLibraryManager(): void {
  window.dispatchEvent(new Event(CLOSE_LIBRARY_MANAGER_EVENT));
}

// Whether the manager is what the games' area shows: the frame's Games and Library Manager buttons light up by it.
let shown = false;
const listeners = new Set<() => void>();
export function setLibraryManagerShown(value: boolean): void {
  if (shown === value) return;
  shown = value;
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useLibraryManagerShown = () => useSyncExternalStore(subscribe, () => shown, () => shown);
