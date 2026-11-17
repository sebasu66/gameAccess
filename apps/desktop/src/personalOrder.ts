/**
 * "Personalized order": a switch next to the catalog's sort that tailors the results to the player's taste
 * (tasteProfile.ts). It combines with any sort: the sort gives the usual order, the switch adapts it and hides games
 * the player is not likely to like. It can be turned on only once the taste profile is ready; LibraryRoom publishes
 * the profile's state here, the toolbar shows it. The player's choice is remembered.
 */
import { useSyncExternalStore } from "react";

const KEY = "gameaccess:personal-order";
export interface PersonalOrderState {
  on: boolean;
  ready: boolean;
  percent: number;
  /** The profile became ready during this session and the switch has not celebrated it yet. */
  unlocked: boolean;
}

let state: PersonalOrderState = { on: readSaved(), ready: false, percent: 0, unlocked: false };
/** The first readiness published is how the session starts, not a change. */
let published = false;
const listeners = new Set<() => void>();

function readSaved(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

function update(next: Partial<PersonalOrderState>): void {
  const merged = { ...state, ...next };
  if (merged.on === state.on && merged.ready === state.ready && merged.percent === state.percent && merged.unlocked === state.unlocked) return;
  state = merged;
  listeners.forEach(listener => listener());
}

export function personalOrderState(): PersonalOrderState { return state; }

/** Whether the results are tailored now: switched on and with a ready profile. */
export function personalOrderActive(): boolean { return state.on && state.ready; }

export function setPersonalOrder(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* the choice lasts for this session only */ }
  update({ on });
}

export function publishTasteReadiness(ready: boolean, percent: number): void {
  const unlocked = published && ready && !state.ready ? true : ready ? state.unlocked : false;
  published = true;
  update({ ready, percent, unlocked });
}

/** The switch showed the unlock. */
export function unlockCelebrated(): void { update({ unlocked: false }); }

export function usePersonalOrder(): PersonalOrderState {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);
}
