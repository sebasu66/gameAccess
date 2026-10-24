import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { hasTauriRuntime } from "../native";
import { getAppLocale } from "../i18n";
import { centralDialog, type Announcement } from "./centralDialog";
import { loadAnnouncements, markAnnouncementsSeen, presentAnnouncements, seenAnnouncements, unseenAnnouncements, type AnnouncementEntry } from "./announcements";

async function appVersion(): Promise<string> {
  try { return hasTauriRuntime() ? await getVersion() : "0.0.0"; } catch { return "0.0.0"; }
}

/** The news shown in the News panel (newest first) and how many are unread (the count on the bell). */
type News = { items: Announcement[]; unread: number };
let news: News = { items: [], unread: 0 };
const listeners = new Set<() => void>();
const publish = (next: News) => { news = next; listeners.forEach(listener => listener()); };

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
 * Loads the announcements once the app is ready. The welcome of the first run still appears in the central dialog;
 * the news go to the News panel (docs/TAREA-interfaz-nueva.md T13), with the unread count on the bell.
 */
export function useAnnouncements(ready = true): { unread: number } {
  const markSeen = useCallback((ids: string[]) => markAnnouncementsSeen(ids), []);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void Promise.all([loadAnnouncements(), appVersion()]).then(([entries, version]: [AnnouncementEntry[], string]) => {
      if (!alive) return;
      const locale = getAppLocale();
      const welcome = unseenAnnouncements(entries.filter(entry => entry.kind === "welcome"), locale, version);
      centralDialog.showAnnouncements(welcome, markSeen);
      const items = presentAnnouncements(entries, locale, version, entry => entry.kind !== "welcome").reverse();
      const seen = seenAnnouncements();
      publish({ items, unread: items.filter(item => !seen.has(item.id)).length });
    });
    return () => { alive = false; };
  }, [ready, markSeen]);
  return { unread: useNews().unread };
}
