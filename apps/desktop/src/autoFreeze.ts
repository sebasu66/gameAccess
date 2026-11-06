import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { scanLibrary } from "./libraryScan";
import { narrate } from "./narrationLog";

const FIRST_CHECK_MS = 5 * 60_000;   // not while the app is still starting
const EVERY_MS = 30 * 60_000;        // one game per check: each one can take minutes

/**
 * While the app is open and the player turned it on (Settings > Games), freeze one game at a time:
 * a month without play gets Windows compression, three months the deep freeze. Never during a download.
 */
export function startAutoFreeze(): () => void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return () => undefined;
  let busy = false;
  const check = async () => {
    if (busy || digitalDownloadService.hasActiveDownloads()) return;
    busy = true;
    try {
      const settings = (await digitalProcessManager.settings()).settings;
      if (!settings?.auto_freeze) return;
      const results = (await digitalProcessManager.autoFreeze()).results ?? [];
      for (const result of results) void narrate(`AppID ${result.app_id} · automatic freeze: ${result.ok ? "done" : result.error}`, { area: "LIBRARY" });
      if (results.length) await scanLibrary();
    } catch (error) {
      void narrate(`Automatic freeze: ${error instanceof Error ? error.message : String(error)}`, { area: "LIBRARY", level: "ERROR" });
    } finally {
      busy = false;
    }
  };
  const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
  const timer = window.setInterval(() => void check(), EVERY_MS);
  return () => { window.clearTimeout(first); window.clearInterval(timer); };
}
