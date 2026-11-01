/**
 * What made a game run where it did not (server: apps/api/app/run_fixes.py). Asked only when a game fails to start here,
 * and reported only when the launch dialog's automatic fix made it start. A fix is a handful of known switches, never
 * commands or paths; the launcher keeps it in the game's execution profile (`learnedFix`).
 */
import { getInstallationId } from "../activation";
import { hasTauriRuntime } from "../native";
import { narrate } from "../narrationLog";
import { getApiBaseUrl } from "../settings";
import { digitalProcessManager } from "./DigitalProcessManager";
import type { CatalogGame } from "../types";

export interface RunFix { steam: boolean; launchers: string[]; language: "keep" | null; runtimes: string[]; fixBackup: boolean; runAsAdmin: boolean }

const learned = new Map<number, RunFix>();
/** The fix the automatic fix found for this game, waiting to know whether the game opened. */
export const holdLearnedFix = (appId: number, fix: RunFix | null | undefined) => { if (fix) learned.set(appId, fix); else learned.delete(appId); };
export const takeLearnedFix = (appId: number): RunFix | null => { const fix = learned.get(appId) ?? null; learned.delete(appId); return fix; };

/** The server's fix for the game ("it does not run here: do you have a fix?"), or null. Never throws. */
export async function fetchRunFix(appId: number, fetcher: typeof fetch = fetch): Promise<RunFix | null> {
  try {
    const [api, installationId] = await Promise.all([getApiBaseUrl(), getInstallationId()]);
    if (!api || !installationId) return null;
    const response = await fetcher(`${api}/run-fixes/${appId}`, { cache: "no-store", signal: AbortSignal.timeout(10000), headers: { "X-GameAccess-Installation": installationId } });
    if (!response.ok) return null;
    const body = await response.json() as { fix?: RunFix | null };
    return body.fix ?? null;
  } catch { return null; }
}

/** The game opened after the automatic fix: keep what worked in its profile and tell the server. Never throws. */
export async function shareRunFix(game: CatalogGame, fix: RunFix, fetcher: typeof fetch = fetch): Promise<void> {
  const appId = game.app_id ?? game.id;
  try { if (hasTauriRuntime()) await digitalProcessManager.saveLearnedFix(game, fix); } catch { /* the report still goes */ }
  try {
    const [api, installationId] = await Promise.all([getApiBaseUrl(), getInstallationId()]);
    if (!api || !installationId) return;
    const response = await fetcher(`${api}/run-fixes/report`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-GameAccess-Installation": installationId },
      body: JSON.stringify({ app_id: appId, fix }),
    });
    void narrate(`Run fix reported for AppID ${appId}: HTTP ${response.status}.`, { area: "DIGITAL_EXECUTION" });
  } catch (error) {
    void narrate(`Run fix could not be reported: ${error instanceof Error ? error.message : String(error)}.`, { area: "DIGITAL_EXECUTION", level: "WARN" });
  }
}
