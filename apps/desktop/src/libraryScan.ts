import { useSyncExternalStore } from "react";
import { digitalProcessManager, type LibraryGame, type LibrarySummary, type LibraryTransfer } from "./catalog/DigitalProcessManager";

/** Result of the last library scan: the Library Manager screen and the game cards share it. */
export interface LibraryScanState { games: LibraryGame[]; transfers: LibraryTransfer[]; summary: LibrarySummary | null; scanning: boolean; error: string }

let state: LibraryScanState = { games: [], transfers: [], summary: null, scanning: false, error: "" };
const listeners = new Set<() => void>();
const publish = (next: Partial<LibraryScanState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let pending: Promise<void> | null = null;

/** Scan the games folder. Safe to call from anywhere: concurrent calls share one scan. */
export function scanLibrary(): Promise<void> {
  if (!hasTauriRuntime()) return Promise.resolve();
  if (pending) return pending;
  publish({ scanning: true, error: "" });
  pending = digitalProcessManager.libraryList()
    .then(result => publish({ games: result.library ?? [], transfers: result.transfers ?? [], summary: result.summary ?? null, scanning: false }))
    .catch(failure => publish({ scanning: false, error: String(failure) }))
    .finally(() => { pending = null; });
  return pending;
}

export const libraryScanState = () => state;
export function useLibraryScan(): LibraryScanState {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, libraryScanState, libraryScanState);
}

/** What keeps this game from the standard, or undefined when it is fine / not scanned yet. */
export function useLibraryFlag(appId?: number): LibraryGame | undefined {
  const scan = useLibraryScan();
  return appId == null ? undefined : scan.games.find(game => game.app_id === appId && !game.standard);
}
