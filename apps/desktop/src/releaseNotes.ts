import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
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
