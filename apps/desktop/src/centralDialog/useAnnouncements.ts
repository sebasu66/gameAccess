import { useCallback, useEffect, useRef } from "react";
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
 * ready, and returns a function that shows all of them again (the "News" button).
 */
export function useAnnouncements(ready = true): () => void {
  const loaded = useRef<{ entries: AnnouncementEntry[]; version: string } | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void Promise.all([loadAnnouncements(), appVersion()]).then(([entries, version]) => {
      loaded.current = { entries, version };
      if (!alive) return;
      centralDialog.showAnnouncements(unseenAnnouncements(entries, getAppLocale(), version), markAnnouncementsSeen);
    });
    return () => { alive = false; };
  }, [ready]);
  return useCallback(() => {
    const show = (entries: AnnouncementEntry[], version: string) =>
      centralDialog.showAnnouncements(presentAnnouncements(entries, getAppLocale(), version).reverse(), markAnnouncementsSeen);
    if (loaded.current) show(loaded.current.entries, loaded.current.version);
    else void Promise.all([loadAnnouncements(), appVersion()]).then(([entries, version]) => show(entries, version));
  }, []);
}
