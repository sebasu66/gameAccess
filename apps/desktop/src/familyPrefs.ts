import { useSyncExternalStore } from "react";

/**
 * Whether the person has children at home, the first question of the kids screen (KidModePanel.tsx). Unanswered
 * (null) the screen asks; "no" leaves Game Access as it always was (no key, no kid mode); "yes" opens the whole
 * setup: kid mode, the content filter and the parent's key, all in that one screen. A child's account or a parent's
 * key already set count as "yes" without the question.
 */
const KEY = "gameaccess.hasKids";
const listeners = new Set<() => void>();

function read(): boolean | null {
  try { const stored = localStorage.getItem(KEY); return stored === "yes" ? true : stored === "no" ? false : null; } catch { return null; }
}
let answer = read();

export const getHasKids = () => answer;
export const useHasKids = (): boolean | null => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getHasKids, getHasKids);

export function setHasKids(value: boolean) {
  answer = value;
  try { localStorage.setItem(KEY, value ? "yes" : "no"); } catch { /* the answer is only a convenience */ }
  for (const listener of listeners) listener();
}

export function resetHasKidsForTests() {
  answer = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing kept */ }
  for (const listener of listeners) listener();
}
