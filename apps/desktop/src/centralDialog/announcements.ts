import type { Announcement } from "./centralDialog";

/**
 * Announcements (the welcome and later news) come from `apps/desktop/public/announcements.json` on the main
 * branch, so news can be published without a new version. The same file ships inside the app, so the welcome
 * also appears on a first run without internet. Each announcement is shown once per player.
 */
export const REMOTE_ANNOUNCEMENTS_URL = "https://raw.githubusercontent.com/sebasu66/gameAccess/refs/heads/main/apps/desktop/public/announcements.json";
export const SEEN_KEY = "gameaccess:announcements_seen";

type Localized = { es?: string; en?: string };
export interface AnnouncementEntry {
  id: string;
  kind?: "welcome" | "news";
  date?: string;
  title: Localized;
  body: Localized;
  minVersion?: string;
  maxVersion?: string;
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function entriesOf(data: unknown): AnnouncementEntry[] {
  const list = (data as { announcements?: unknown })?.announcements;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is AnnouncementEntry =>
    !!item && typeof item.id === "string" && typeof item.title === "object" && typeof item.body === "object");
}

async function fetchJson(url: string, fetcher: typeof fetch, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { cache: "no-store", signal: controller.signal });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Every announcement known: the published file merged over the bundled one (published wins by id). */
export async function loadAnnouncements(fetcher: typeof fetch = fetch): Promise<AnnouncementEntry[]> {
  const [bundled, published] = await Promise.all([
    fetchJson("/announcements.json", fetcher, 3000),
    fetchJson(REMOTE_ANNOUNCEMENTS_URL, fetcher, 6000),
  ]);
  const byId = new Map<string, AnnouncementEntry>();
  for (const entry of [...entriesOf(bundled), ...entriesOf(published)]) byId.set(entry.id, entry);
  return [...byId.values()];
}

export function seenAnnouncements(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter(item => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function markAnnouncementsSeen(ids: string[]): void {
  try {
    const seen = seenAnnouncements();
    for (const id of ids) seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch { /* storage is best-effort: at worst an announcement shows again */ }
}

/** The announcements for this app version and language: welcome ones first, then news oldest to newest. */
export function presentAnnouncements(entries: AnnouncementEntry[], locale: string, version: string, only?: (entry: AnnouncementEntry) => boolean): Announcement[] {
  const lang = locale === "es" ? "es" : "en";
  return entries
    .filter(entry => (!entry.minVersion || compareVersions(version, entry.minVersion) >= 0)
      && (!entry.maxVersion || compareVersions(version, entry.maxVersion) <= 0)
      && (!only || only(entry)))
    .sort((a, b) => (a.kind === "welcome" ? 0 : 1) - (b.kind === "welcome" ? 0 : 1) || (a.date || "").localeCompare(b.date || ""))
    .map(entry => ({
      id: entry.id, date: entry.date,
      title: entry.title[lang] || entry.title.es || entry.title.en || "",
      body: entry.body[lang] || entry.body.es || entry.body.en || "",
    }))
    .filter(item => item.title && item.body);
}

export function unseenAnnouncements(entries: AnnouncementEntry[], locale: string, version: string): Announcement[] {
  const seen = seenAnnouncements();
  return presentAnnouncements(entries, locale, version, entry => !seen.has(entry.id));
}
