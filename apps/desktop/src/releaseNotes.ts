import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { recordActivity } from "./activity/activity";
import { setAppScreen } from "./appScreen";
import { translate } from "./i18n";
import { hasTauriRuntime } from "./native";

/**
 * What changed in the installed version, for the card at the top of Home. The notes ship inside the app
 * (`public/changelog.json`), so they always match the version that runs, also without internet.
 */
type Localized = { es?: string[]; en?: string[] };
export interface ReleaseEntry { version: string; date?: string; changes: Localized }
export interface ReleaseNotes { version: string; date?: string; changes: string[] }

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * The notes of the installed version: its own entry, or the newest one not newer than it (a build between two
 * releases). Outside the app (version 0.0.0, the browser preview) the newest entry.
 */
export function notesFor(data: unknown, version: string, locale: string): ReleaseNotes | null {
  const list = (data as { versions?: unknown })?.versions;
  if (!Array.isArray(list)) return null;
  const entries = list.filter((item): item is ReleaseEntry => !!item && typeof item.version === "string" && typeof item.changes === "object")
    .sort((a, b) => compareVersions(b.version, a.version));
  const entry = version === "0.0.0" ? entries[0] : entries.find(item => compareVersions(item.version, version) <= 0);
  if (!entry) return null;
  const lang = locale === "es" ? "es" : "en";
  const changes = (entry.changes[lang] || entry.changes.es || entry.changes.en || []).filter(line => typeof line === "string" && line.trim());
  return changes.length ? { version: entry.version, date: entry.date, changes } : null;
}

const VERSION_KEY = "gameaccess:app-version";
/** Shows the version's notes on Home (HomeScreen.tsx). Home may not be drawn yet: it asks when it is. */
export const OPEN_RELEASE_NOTES_EVENT = "gameaccess:open-release-notes";
let pendingNotes = false;

export function openReleaseNotes(): void {
  pendingNotes = true;
  setAppScreen("home");
  window.dispatchEvent(new Event(OPEN_RELEASE_NOTES_EVENT));
}

export function takePendingReleaseNotes(): boolean {
  const pending = pendingNotes;
  pendingNotes = false;
  return pending;
}

/** Tells the Activity panel that the app was updated, once per version. A new install has nothing to tell. */
export function noteAppVersion(version: string, now = Date.now()): void {
  try {
    const last = localStorage.getItem(VERSION_KEY);
    if (last === version) return;
    localStorage.setItem(VERSION_KEY, version);
    if (last) recordActivity({ key: `app:${version}`, kind: "app", category: "app", title: translate("activityAppUpdated", { version }), tone: "ok", state: "done" }, now);
  } catch { /* storage may be blocked */ }
}

/** The start of the app: compares the running version with the one seen last. */
export function trackAppVersion(): void {
  if (hasTauriRuntime()) void getVersion().then(version => noteAppVersion(version)).catch(() => undefined);
}

export function useReleaseNotes(locale: string): ReleaseNotes | null {
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  useEffect(() => {
    let alive = true;
    const version = hasTauriRuntime() ? getVersion().catch(() => "0.0.0") : Promise.resolve("0.0.0");
    void Promise.all([fetch("/changelog.json", { cache: "no-store" }).then(response => response.ok ? response.json() : null).catch(() => null), version])
      .then(([data, current]) => { if (alive) setNotes(notesFor(data, current, locale)); });
    return () => { alive = false; };
  }, [locale]);
  return notes;
}
