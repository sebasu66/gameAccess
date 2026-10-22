import { useSyncExternalStore } from "react";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { formatBytes } from "./GenericDownloadProgress";
import { translate } from "./i18n";
import { scanLibrary } from "./libraryScan";
import { notify } from "./toasts";
import type { FreezeMode } from "./FreezeDialog";
import type { CatalogGame } from "./types";

/**
 * Freezing a big game takes many minutes (BeamNG.drive: 13). The work belongs to the app, not to the dialog
 * that started it: the game menu can close meanwhile (Esc, another game, leaving the detail) and take the
 * dialog with it. A job keeps running, a reopened dialog shows the same job, and when no dialog is watching
 * the result (or the error) arrives as a toast instead of being lost.
 */
export interface FreezeOutcome { ok: boolean; detail: string }
export interface FreezeJob { appId: number; name: string; mode: FreezeMode; done: Promise<FreezeOutcome>; watchers: number }

const jobs = new Map<number, FreezeJob>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const freezeTitle = (mode: FreezeMode, name: string) =>
  translate(mode === "thaw" ? "thawTitle" : mode === "deep" ? "deepFreezeTitle" : "freezeTitle", { name });

export function freezeJob(appId: number): FreezeJob | undefined { return jobs.get(appId); }

export function startFreezeJob(game: CatalogGame, mode: FreezeMode): FreezeJob {
  const appId = game.app_id ?? game.id;
  const running = jobs.get(appId);
  if (running) return running;
  const work = async (): Promise<FreezeOutcome> => {
    try {
      const result = mode === "thaw" ? await digitalProcessManager.thaw(game) : await digitalProcessManager.freeze(game, mode);
      const frozen = (result as { frozen?: { stored_bytes?: number; original_bytes?: number } }).frozen;
      return { ok: true, detail: frozen ? translate("freezeDone", { stored: formatBytes(frozen.stored_bytes), original: formatBytes(frozen.original_bytes) }) : translate("thawDone") };
    } catch (error) {
      return { ok: false, detail: translate("freezeFailed", { error: error instanceof Error ? error.message : String(error) }) };
    }
  };
  const job: FreezeJob = { appId, name: game.name, mode, watchers: 0, done: Promise.resolve({ ok: false, detail: "" }) };
  job.done = work().then(async outcome => {
    jobs.delete(appId);
    // Whatever happened, the library shows the game's state as it is now (a failed freeze leaves no record).
    await scanLibrary().catch(() => undefined);
    if (job.watchers === 0) notify(`${freezeTitle(mode, game.name)}: ${outcome.detail}`, { tone: outcome.ok ? "success" : "error", durationMs: outcome.ok ? undefined : 0 });
    emit();
    return outcome;
  });
  jobs.set(appId, job);
  emit();
  return job;
}

/** A dialog showing the job: while one watches, it shows the result itself and no toast is needed. */
export function watchFreezeJob(job: FreezeJob): () => void {
  job.watchers += 1;
  return () => { job.watchers -= 1; };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useFreezeJob(appId: number | null | undefined): FreezeJob | undefined {
  return useSyncExternalStore(subscribe, () => (appId ? jobs.get(appId) : undefined), () => undefined);
}
