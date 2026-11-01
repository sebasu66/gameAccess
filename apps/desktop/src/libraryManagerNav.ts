/** Asks the library to show the Library Manager, on this game's row when given (the processes panel's tasks). */
export const OPEN_LIBRARY_MANAGER_EVENT = "gameaccess:open-library-manager";

export function openLibraryManager(appId?: number): void {
  window.dispatchEvent(new CustomEvent<{ appId?: number }>(OPEN_LIBRARY_MANAGER_EVENT, { detail: { appId } }));
}
