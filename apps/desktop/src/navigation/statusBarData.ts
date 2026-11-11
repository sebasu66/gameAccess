import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { LibrarySummary } from "../catalog/DigitalProcessManager";
import { CATALOG_REFRESH_STATUS, getLastCatalogSyncTime } from "../catalogUpdates";
import { hasTauriRuntime } from "../native";

/** The share of the games disk that is free, rounded; null until the library was read. */
export function diskFreePercent(summary: Pick<LibrarySummary, "disk_free_bytes" | "disk_total_bytes"> | null | undefined): number | null {
  const free = summary?.disk_free_bytes, total = summary?.disk_total_bytes;
  if (free == null || !total) return null;
  return Math.max(0, Math.min(100, Math.round((free / total) * 100)));
}

/** "12,4 MB/s": the speed of every download together, one decimal under 100. */
export function formatSpeed(bytesPerSecond: number, locale: string): string {
  const units = ["B/s", "KB/s", "MB/s", "GB/s"]; let value = Math.max(0, bytesPerSecond); let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString(locale, { maximumFractionDigits: value < 100 && unit > 0 ? 1 : 0 })} ${units[unit]}`;
}

/** "11:02" for today; with the day before it otherwise ("9 nov 11:02"). */
export function formatSyncTime(at: number, now: number, locale: string): string {
  const time = new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (new Date(at).toDateString() === new Date(now).toDateString()) return time;
  return `${new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short" })} ${time}`;
}

/** When the catalog was last brought up to date, and whether it is being updated now. */
export function useCatalogSync(): { at: number; busy: boolean } {
  const [sync, setSync] = useState(() => ({ at: getLastCatalogSyncTime(), busy: false }));
  useEffect(() => {
    const changed = (event: Event) => setSync({ at: getLastCatalogSyncTime(), busy: Boolean((event as CustomEvent<{ busy?: boolean }>).detail?.busy) });
    // The hourly and on-open updates record the time without always telling: read it again now and then.
    const timer = window.setInterval(() => setSync(previous => ({ ...previous, at: getLastCatalogSyncTime() })), 60_000);
    window.addEventListener(CATALOG_REFRESH_STATUS, changed);
    return () => { window.clearInterval(timer); window.removeEventListener(CATALOG_REFRESH_STATUS, changed); };
  }, []);
  return sync;
}

/** The installed app's version ("" outside the app, as in the browser preview). */
export function useAppVersion(): string {
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let live = true;
    void getVersion().then(value => { if (live) setVersion(value); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return version;
}
