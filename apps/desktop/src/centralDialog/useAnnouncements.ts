import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { hasTauriRuntime } from "../native";
import { getAppLocale } from "../i18n";
import { centralDialog } from "./centralDialog";
import { loadAnnouncements, markAnnouncementsSeen, presentAnnouncements, unseenAnnouncements, type AnnouncementEntry } from "./announcements";

async function appVersion(): Promise<string> {
  try { return hasTauriRuntime() ? await getVersion() : "0.0.0"; } catch { return "0.0.0"; }
}

/**
 * Shows the announcements this player has not seen (the welcome on the first run, then news) once the app is
 * ready, and returns a function that shows all of them again (the "News" button) plus how many are still unread
 * (the count on the bell); they count as read once shown.
 */
export function useAnnouncements(ready = true): { show: () => void; unread: number } {
  const loaded = useRef<{ entries: AnnouncementEntry[]; version: string } | null>(null);
  const [unread, setUnread] = useState(0);
  const markSeen = useCallback((ids: string[]) => { markAnnouncementsSeen(ids); setUnread(0); }, []);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void Promise.all([loadAnnouncements(), appVersion()]).then(([entries, version]) => {
      loaded.current = { entries, version };
      if (!alive) return;
      const unseen = unseenAnnouncements(entries, getAppLocale(), version);
      setUnread(unseen.length);
      centralDialog.showAnnouncements(unseen, markSeen);
    });
    return () => { alive = false; };
  }, [ready, markSeen]);
  const show = useCallback(() => {
    const present = (entries: AnnouncementEntry[], version: string) =>
      centralDialog.showAnnouncements(presentAnnouncements(entries, getAppLocale(), version).reverse(), markSeen);
    if (loaded.current) present(loaded.current.entries, loaded.current.version);
    else void Promise.all([loadAnnouncements(), appVersion()]).then(([entries, version]) => present(entries, version));
  }, [markSeen]);
  return { show, unread };
}
