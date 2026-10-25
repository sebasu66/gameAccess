import { translate } from "./i18n";
import { narrate } from "./narrationLog";
import { hideNotice, showNotice } from "./notice/notice";
import { openPanel } from "./desk/desk";

/**
 * Games that became downloadable: new games from a catalog update matched to download sources already saved, or
 * games that got their first source from a plugin sync (both matched locally, see source_index.rs). Each finding is
 * a news item (News panel, counted on the bell until it is opened) and a notice with OK and More.
 */
export interface DownloadNews { id: string; date: string; appIds: number[] }

export const DOWNLOAD_NEWS_KEY = "gameaccess:download_news";
const KEEP = 20;
const listeners = new Set<() => void>();

export function storedDownloadNews(): DownloadNews[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DOWNLOAD_NEWS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === "string" && Array.isArray(item.appIds)) : [];
  } catch {
    return [];
  }
}

/** Called whenever the stored download news change (the news store merges them with the announcements). */
export function onDownloadNews(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Records the games that became downloadable (games already reported are left out) and tells the player. */
export function recordNewDownloads(appIds: number[], origin: "catalog" | "plugin", now = new Date()): DownloadNews | null {
  const stored = storedDownloadNews();
  const known = new Set(stored.flatMap(item => item.appIds));
  const fresh = [...new Set(appIds)].filter(id => Number.isInteger(id) && !known.has(id));
  if (!fresh.length) return null;
  const item: DownloadNews = { id: `downloads-${now.getTime()}`, date: now.toISOString().slice(0, 10), appIds: fresh };
  try { localStorage.setItem(DOWNLOAD_NEWS_KEY, JSON.stringify([item, ...stored].slice(0, KEEP))); } catch { /* the notice still shows */ }
  const shown = fresh.slice(0, 20).join(", ") + (fresh.length > 20 ? ", …" : "");
  void narrate(`New downloads: ${fresh.length} game(s) can now be downloaded after a ${origin === "catalog" ? "catalog update" : "plugin sync"} (AppIDs ${shown}).`,
    { area: "DOWNLOAD_SOURCES" });
  listeners.forEach(listener => listener());
  let notice = 0;
  notice = showNotice({
    tone: "ok",
    title: translate("newDownloadsTitle"),
    text: downloadNewsText(fresh.length),
    timer: true,
    actions: [
      { label: translate("noticeOk"), kind: "secondary", run: () => hideNotice(notice) },
      { label: translate("newDownloadsMore"), kind: "primary", run: () => { hideNotice(notice); openPanel("news"); } },
    ],
  });
  return item;
}

export function downloadNewsText(count: number): string {
  return count === 1 ? translate("newDownloadsTextOne") : translate("newDownloadsTextMany", { count });
}
