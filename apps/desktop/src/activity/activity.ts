import { useSyncExternalStore } from "react";
import type { NoticeTone } from "../notice/notice";

/**
 * The activity history (docs/GUI_DESIGN.md §4.9 and §4.17): every notice and every background process leaves an
 * entry here, shown in the Activity panel like Windows 11's notifications. One entry per process: a download or a
 * freeze keeps its key and changes state (started, working, done or failed) instead of adding a second entry.
 * Kept on this computer: up to 200 entries, none older than 30 days.
 */
export type ActivityState = "running" | "done" | "failed" | "info";
export interface ActivityEntry {
  id: string;
  /** The same process keeps the same key (`download:<appId>`, `freeze:<appId>`); a plain notice has its own. */
  key: string;
  title: string;
  text?: string;
  tone: NoticeTone;
  state: ActivityState;
  /** The game it is about: its row in the Library Manager has the detail. */
  appId?: number;
  name?: string;
  image?: string | null;
  /** A news item on Home that has the detail (the games a plugin or the catalog made downloadable). */
  news?: string;
  startedAt: number;
  endedAt?: number;
  seen: boolean;
}
export type ActivityInput = Omit<ActivityEntry, "id" | "startedAt" | "endedAt" | "seen" | "key"> & { key?: string };

const STORAGE_KEY = "gameaccess:activity";
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 30 * 86_400_000;
const listeners = new Set<() => void>();
let entries: ActivityEntry[] = load();
let nextId = 1;

function load(): ActivityEntry[] {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "[]") as ActivityEntry[];
    // A process that was running when the app closed is not running any more: it shows as it was left.
    return Array.isArray(saved) ? prune(saved.map(entry => entry.state === "running" ? { ...entry, state: "info" } : entry)) : [];
  } catch { return []; }
}

function prune(list: ActivityEntry[]): ActivityEntry[] {
  const oldest = Date.now() - MAX_AGE_MS;
  return list.filter(entry => (entry.endedAt ?? entry.startedAt) >= oldest).slice(0, MAX_ENTRIES);
}

function save(next: ActivityEntry[]) {
  entries = prune(next);
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* storage may be blocked */ }
  listeners.forEach(listener => listener());
}

/** Adds an entry, or changes the one of the same process (same key) and brings it to the top. Returns its key. */
export function recordActivity(input: ActivityInput): string {
  const key = input.key ?? `notice:${Date.now()}:${nextId++}`;
  const now = Date.now();
  const previous = entries.find(entry => entry.key === key);
  // The end is when it stopped running; an entry that never ran ends when it happens.
  const endedAt = input.state === "running" ? undefined : previous && previous.state !== "running" && previous.endedAt ? previous.endedAt : now;
  const entry: ActivityEntry = { ...previous, ...input, key, id: previous?.id ?? key, startedAt: previous?.startedAt ?? now, endedAt, seen: false };
  save([entry, ...entries.filter(item => item.key !== key)]);
  return key;
}

/** Opening the panel counts every entry as seen. */
export function markActivitySeen(): void {
  if (entries.every(entry => entry.seen)) return;
  save(entries.map(entry => entry.seen ? entry : { ...entry, seen: true }));
}

/** "Clear history": the finished entries go; what is still running stays. */
export function clearActivity(): void {
  save(entries.filter(entry => entry.state === "running"));
}

export const activitySnapshot = () => entries;

export function useActivity(): ActivityEntry[] {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, activitySnapshot, activitySnapshot);
}
