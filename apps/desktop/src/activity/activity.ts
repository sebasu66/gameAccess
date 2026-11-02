import { useSyncExternalStore } from "react";
import type { NoticeTone } from "../notice/notice";

/**
 * The activity history (docs/GUI_DESIGN.md §4.9 and §4.17): every notice and every background process leaves an
 * entry here, shown in the Activity panel like Windows 11's notifications. One entry per process: a download or a
 * freeze keeps its key and changes state (started, working, done or failed) instead of adding a second entry.
 * A notice of a kind (new downloads, the taste profile, a verification) joins the last entry of its kind when that is
 * the newest entry or is less than an hour old (Seba, 2026-11-02): "lines" adds its text as one more line under the
 * same title, "replace" puts its text in place of the old one. The same text is never listed twice in a row.
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
  /** What it is about (`news`, `taste`, `verify`…): its look in the panel, and what a new notice of it joins. */
  kind?: string;
  /** The texts of the notices joined into this entry, oldest first, each with when it came. */
  lines?: Array<{ at: number; text: string }>;
  startedAt: number;
  endedAt?: number;
  seen: boolean;
}
export type ActivityInput = Omit<ActivityEntry, "id" | "startedAt" | "endedAt" | "seen" | "key" | "lines"> & {
  key?: string;
  /** How a notice of the same kind joins the last one: one more line, or the new text in place of the old. */
  merge?: "lines" | "replace";
};

const STORAGE_KEY = "gameaccess:activity";
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 30 * 86_400_000;
/** A notice joins the last one of its kind within this time (or when that one is still the newest entry). */
export const MERGE_WINDOW_MS = 60 * 60_000;
const MAX_LINES = 6;
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
export function recordActivity(input: ActivityInput, now = Date.now()): string {
  const { merge, ...fields } = input;
  const joined = !input.key && input.kind && merge ? joinable(input.kind, now) : undefined;
  if (joined) return join(joined, fields, merge!, now);
  const key = input.key ?? `notice:${now}:${nextId++}`;
  const previous = entries.find(entry => entry.key === key);
  // The end is when it stopped running; an entry that never ran ends when it happens.
  const endedAt = input.state === "running" ? undefined : previous && previous.state !== "running" && previous.endedAt ? previous.endedAt : now;
  const entry: ActivityEntry = { ...previous, ...fields, key, id: previous?.id ?? key, startedAt: previous?.startedAt ?? now, endedAt, seen: false };
  save([entry, ...entries.filter(item => item.key !== key)]);
  return key;
}

/** The last entry of a kind that a new notice of it joins: the newest of the history, or one less than an hour old. */
function joinable(kind: string, now: number): ActivityEntry | undefined {
  const history = entries.filter(entry => entry.state !== "running");
  const last = history.find(entry => entry.kind === kind);
  if (!last) return undefined;
  return last === history[0] || now - (last.endedAt ?? last.startedAt) < MERGE_WINDOW_MS ? last : undefined;
}

/** A notice joined into the last entry of its kind: that entry comes to the top with the new information. */
function join(previous: ActivityEntry, fields: Omit<ActivityInput, "merge">, merge: "lines" | "replace", now: number): string {
  const lines = previous.lines ?? (previous.text ? [{ at: previous.endedAt ?? previous.startedAt, text: previous.text }] : []);
  const text = fields.text ?? "";
  const next: ActivityEntry = merge === "lines"
    ? { ...previous, ...fields, title: previous.title, lines: text && lines.at(-1)?.text !== text ? [...lines, { at: now, text }].slice(-MAX_LINES) : lines }
    // Replaced, it is as if it had just come: its time is the new one.
    : { ...previous, ...fields, lines: undefined, startedAt: now };
  save([{ ...next, endedAt: now, seen: false }, ...entries.filter(item => item.key !== previous.key)]);
  return previous.key;
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
