import { useEffect, useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { hasTauriRuntime } from "../native";
import { getAppLocale, translate } from "../i18n";
import { downloadNewsText, onDownloadNews, storedDownloadNews } from "../newDownloads";
import type { Announcement } from "./centralDialog";
import { loadAnnouncements, markAnnouncementsSeen, presentAnnouncements, seenAnnouncements, type AnnouncementEntry } from "./announcements";

async function appVersion(): Promise<string> {
  try { return hasTauriRuntime() ? await getVersion() : "0.0.0"; } catch { return "0.0.0"; }
}

/** The welcome (at the top of Home), the news shown in the News panel (newest first) and how many are unread. */
type News = { welcome: Announcement[]; items: Announcement[]; unread: number };
let news: News = { welcome: [], items: [], unread: 0 };
const listeners = new Set<() => void>();
const publish = (next: News) => { news = next; listeners.forEach(listener => listener()); };
/** The announcements published by the project (loaded once the app is ready). */
let remote: Announcement[] = [];
let welcome: Announcement[] = [];

/** The announcements and the download news (games that became downloadable), newest first; unread until seen. */
function merged(): News {
  const downloads: Announcement[] = storedDownloadNews().map(item => ({
    id: item.id, date: item.date, games: item.appIds, title: translate("newDownloadsNewsTitle"), body: downloadNewsText(item.appIds.length, item),
  }));
  const items = [...downloads, ...remote].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const seen = seenAnnouncements();
  return { welcome, items, unread: items.filter(item => !seen.has(item.id)).length };
}
/** Recomputes the news (after a change, and when the app opens: the download news are stored on this computer). */
export function refreshNews(): void { publish(merged()); }
/** The current news, outside React (tests and non-UI code). */
export function newsSnapshot(): News { return news; }
onDownloadNews(refreshNews);

export function useNews(): News {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => news, () => news);
}

/** Opening the News panel counts its news as read. */
export function markNewsRead(): void {
  if (!news.unread) return;
  markAnnouncementsSeen(news.items.map(item => item.id));
  publish({ ...news, unread: 0 });
}

/**
 * Loads the announcements once the app is ready. The welcome is part of Home, where a new install opens (Seba,
 * 2026-11-03: it was a dialog over the catalog); the news go to the News panel (docs/TAREA-interfaz-nueva.md T13),
 * with the unread count on the bell.
 */
export function useAnnouncements(ready = true): { unread: number } {
  useEffect(() => {
    if (!ready) return;
    refreshNews();
    let alive = true;
    void Promise.all([loadAnnouncements(), appVersion()]).then(([entries, version]: [AnnouncementEntry[], string]) => {
      if (!alive) return;
      const locale = getAppLocale();
      welcome = presentAnnouncements(entries, locale, version, entry => entry.kind === "welcome");
      remote = presentAnnouncements(entries, locale, version, entry => entry.kind !== "welcome").reverse();
      refreshNews();
    });
    return () => { alive = false; };
  }, [ready]);
  return { unread: useNews().unread };
}
