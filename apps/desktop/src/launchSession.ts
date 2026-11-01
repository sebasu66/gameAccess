import { useSyncExternalStore } from "react";
import type { CatalogGame } from "./types";

/**
 * The launch dialog's state (LaunchDialog.tsx): one launch at a time. For the first LAUNCH_LOCK_MS the dialog cannot be
 * closed and nothing else can be launched; if the game has not opened by then it turns into the error mode (it still
 * closes by itself if the game opens later).
 */
export const LAUNCH_LOCK_MS = 10_000;
export type LaunchPhase = "starting" | "opened" | "failed";
export interface LaunchSession { id: number; game: CatalogGame; phase: LaunchPhase; error: string; startedAt: number }

let current: LaunchSession | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const set = (next: LaunchSession | null) => { current = next; listeners.forEach(listener => listener()); };

export const getLaunch = () => current;
/** True while the launch dialog is up (starting or failed and still on screen): no other game is launched. */
export const launchLocked = () => current !== null;
export function beginLaunch(game: CatalogGame): LaunchSession {
  const session: LaunchSession = { id: ++counter, game, phase: "starting", error: "", startedAt: Date.now() };
  set(session);
  return session;
}
export function launchOpened(id: number) { if (current?.id === id) set({ ...current, phase: "opened", error: "" }); }
export function launchFailed(id: number, error: string) { if (current?.id === id) set({ ...current, phase: "failed", error }); }
export function closeLaunch(id?: number) { if (!id || current?.id === id) set(null); }
export function useLaunch(): LaunchSession | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLaunch, getLaunch);
}
