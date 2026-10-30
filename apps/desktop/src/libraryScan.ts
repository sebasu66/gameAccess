import { useSyncExternalStore } from "react";
import { notify } from "./toasts";
import { translate } from "./i18n";
import { digitalProcessManager, type LibraryGame, type LibrarySummary, type LibraryTransfer, type LibraryUsage } from "./catalog/DigitalProcessManager";
import { demoGames, demoSummary, demoTransfers, demoUsage } from "./library-manager/demoData";
import { uiDemo } from "./devDemo/uiDemo";

/** Result of the last library scan: the Library Manager screen and the game cards share it. */
export interface LibraryScanState { games: LibraryGame[]; transfers: LibraryTransfer[]; summary: LibrarySummary | null; usage: LibraryUsage | null; scanning: boolean; error: string }

let state: LibraryScanState = { games: [], transfers: [], summary: null, usage: null, scanning: false, error: "" };
const listeners = new Set<() => void>();
const publish = (next: Partial<LibraryScanState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** Design preview in the browser: sample data instead of the launcher (never in a production build). */
export const libraryDemo = () => Boolean(import.meta.env?.DEV) && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("libraryDemo");
let pending: Promise<void> | null = null;

/** Scan the games folder. Safe to call from anywhere: concurrent calls share one scan. */
/** `heal`: the manager's "Refresh" button, which also looks again at broken game folders and says which became ready. */
export function scanLibrary(heal = false): Promise<void> {
  if (libraryDemo() || uiDemo()) { publish({ games: demoGames, transfers: demoTransfers, summary: demoSummary, usage: demoUsage, scanning: false }); return Promise.resolve(); }
  if (!hasTauriRuntime()) return Promise.resolve();
  if (pending) return pending;
  publish({ scanning: true, error: "" });
  pending = digitalProcessManager.libraryList(heal)
    .then(result => {
      const healed = (result as { healed?: string[] }).healed ?? [];
      if (healed.length) notify(translate("libHealed", { names: healed.join(", ") }), { tone: "success" });
      return result;
    })
    .then(result => publish({ games: result.library ?? [], transfers: result.transfers ?? [], summary: result.summary ?? null, usage: result.usage ?? null, scanning: false }))
    .catch(failure => publish({ scanning: false, error: String(failure) }))
    .finally(() => { pending = null; });
  return pending;
}

export const libraryScanState = () => state;
export function useLibraryScan(): LibraryScanState {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, libraryScanState, libraryScanState);
}

/** The scanned library row of an installed game (its folder, the download it came from). */
export function useLibraryEntry(appId?: number): LibraryGame | undefined {
  const scan = useLibraryScan();
  return appId == null ? undefined : scan.games.find(game => game.app_id === appId);
}

/** What keeps this game from the standard, or undefined when it is fine / not scanned yet. */
export function useLibraryFlag(appId?: number): LibraryGame | undefined {
  const scan = useLibraryScan();
  // A download still pending is not a problem yet: nothing can be fixed until it ends.
  return appId == null ? undefined : scan.games.find(game => game.app_id === appId && !game.standard && !game.unfinished);
}
