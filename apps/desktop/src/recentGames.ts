import { useEffect, useState } from "react";
export const PLAY_HISTORY_EVENT = "gameaccess:play-history-changed";
const key = "gameaccess:last-played";
export function readPlayHistory(): Record<number, number> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return Object.fromEntries(Object.entries(value).filter(([id, time]) => Number(id) > 0 && typeof time === "number" && Number.isFinite(time) && time > 0));
  } catch { return {}; }
}
export function mergePlayHistory(entries: Record<number, number>) {
  const history = readPlayHistory();
  let changed = false;
  for (const [id, time] of Object.entries(entries)) {
    if (Number(id) > 0 && Number.isFinite(time) && time > (history[Number(id)] || 0)) { history[Number(id)] = time; changed = true; }
  }
  if (!changed) return;
  try { localStorage.setItem(key, JSON.stringify(history)); } catch { return; }
  window.dispatchEvent(new Event(PLAY_HISTORY_EVENT));
}
export function recordPlayed(appId: number) { mergePlayHistory({ [appId]: Date.now() }); }
export function usePlayHistory() {
  const [history, setHistory] = useState(readPlayHistory);
  useEffect(() => {
    const refresh = () => setHistory(readPlayHistory());
    window.addEventListener(PLAY_HISTORY_EVENT, refresh);
    return () => window.removeEventListener(PLAY_HISTORY_EVENT, refresh);
  }, []);
  return history;
}
