import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";

/**
 * Big picture mode: the library's ready-to-play games only, driven with a controller (move, A to play). Panels, the
 * game detail, menus, search and filters stay closed while it is on; downloads keep going in the background.
 * LibraryRoom turns it on and off (button, F11, the controller's Menu button); the rest reads it here.
 */
let active = false;
const listeners = new Set<() => void>();

export const bigPictureActive = () => active;

export function setBigPictureActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useBigPicture(): boolean {
  return useSyncExternalStore(subscribe, bigPictureActive, () => false);
}

/**
 * Whether a controller is connected. The app asks Windows (the webview lists a controller only after one of its
 * buttons was pressed); in a plain browser the Gamepad API is all there is.
 */
export async function controllerConnected(deps: { native: boolean; ask: () => Promise<number>; pads: () => ArrayLike<Gamepad | null> } = {
  native: hasTauriRuntime(),
  ask: () => invoke<number>("game_controllers_connected"),
  pads: () => navigator.getGamepads?.() ?? [],
}): Promise<boolean> {
  if (Array.from(deps.pads()).some(pad => pad?.connected)) return true;
  if (!deps.native) return false;
  try { return (await deps.ask()) > 0; } catch { return false; }
}
