import { useSyncExternalStore } from "react";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { demoFreeze } from "./devDemo/freezeDemo";
import { uiDemo } from "./devDemo/uiDemo";
import { formatBytes } from "./GenericDownloadProgress";
import { translate } from "./i18n";
import { libraryDemo, scanLibrary } from "./libraryScan";
import { freezeProgress, hasTauriRuntime, type FreezeProgress } from "./native";
import { notify } from "./toasts";
import type { FreezeMode } from "./FreezeDialog";
import type { CatalogGame } from "./types";

/**
 * Freezing a big game takes minutes. The work belongs to the app, not to the dialog that asked for it: the dialog
 * only confirms, and the freeze console (FreezeConsole) shows the job while the rest of the app stays usable. The
 * console reads the launcher's progress (step, share, bytes, file, events) a few times a second. A job stays in the
 * console after it ends, with its result, until it is dismissed; when the console is not open, the result (or the
 * error) arrives as a toast instead.
 */
export interface FreezeOutcome { ok: boolean; detail: string }
export interface FreezeJob {
  appId: number; name: string; mode: FreezeMode; game: CatalogGame; startedAt: number;
  done: Promise<FreezeOutcome>; progress?: FreezeProgress; outcome?: FreezeOutcome;
}

const POLL_MS = 400;
const jobs = new Map<number, FreezeJob>();     // running and finished, until dismissed from the console
const listeners = new Set<() => void>();
let snapshot: { jobs: FreezeJob[]; open: boolean; focus: number | null } = { jobs: [], open: false, focus: null };
let open = false;
let focus: number | null = null;
const emit = () => {
  snapshot = { jobs: [...jobs.values()].map(job => ({ ...job })), open, focus };
  listeners.forEach(listener => listener());
};

export const freezeTitle = (mode: FreezeMode, name: string) =>
  translate(mode === "thaw" ? "thawTitle" : mode === "deep" ? "deepFreezeTitle" : "freezeTitle", { name });

/** The job of a game that is still working (a finished one does not stop a new freeze). */
export function freezeJob(appId: number): FreezeJob | undefined {
  const job = jobs.get(appId);
  return job && !job.outcome ? job : undefined;
}

/** Show the console, on this game's job when given. */
export function openFreezeConsole(appId?: number): void {
  open = true;
  if (appId != null) focus = appId;
  emit();
}

/** Fold the console into its small chip; the work goes on. */
export function collapseFreezeConsole(): void {
  open = false;
  emit();
}

/** Take a finished job out of the console. */
export function dismissFreezeJob(appId: number): void {
  const job = jobs.get(appId);
  if (!job?.outcome) return;
  jobs.delete(appId);
  if (focus === appId) focus = [...jobs.keys()].at(-1) ?? null;
  if (!jobs.size) open = false;
  emit();
}

export function startFreezeJob(game: CatalogGame, mode: FreezeMode): FreezeJob {
  const appId = game.app_id ?? game.id;
  const running = freezeJob(appId);
  if (running) { openFreezeConsole(appId); return running; }
  const job: FreezeJob = { appId, name: game.name, mode, game, startedAt: Date.now(), done: Promise.resolve({ ok: false, detail: "" }) };
  // The browser previews (?uiDemo, ?libraryDemo) have no launcher: the console plays a made-up freeze.
  const demo = (uiDemo() || libraryDemo()) && !hasTauriRuntime();
  // The launcher's progress file; an older one (from the last freeze of this game) is not this job's.
  const poll = demo ? 0 : window.setInterval(() => {
    void freezeProgress(appId).then(progress => {
      if (!progress || progress.started_at * 1000 < job.startedAt - 5000 || jobs.get(appId) !== job) return;
      job.progress = progress;
      emit();
    }).catch(() => undefined);
  }, POLL_MS);
  const work = async (): Promise<FreezeOutcome> => {
    try {
      const result = demo ? await demoFreeze(mode, progress => { job.progress = progress; emit(); })
        : mode === "thaw" ? await digitalProcessManager.thaw(game) : await digitalProcessManager.freeze(game, mode);
      const frozen = (result as { frozen?: { stored_bytes?: number; original_bytes?: number } }).frozen;
      return { ok: true, detail: frozen ? translate("freezeDone", { stored: formatBytes(frozen.stored_bytes), original: formatBytes(frozen.original_bytes) }) : translate("thawDone") };
    } catch (error) {
      return { ok: false, detail: translate("freezeFailed", { error: error instanceof Error ? error.message : String(error) }) };
    }
  };
  job.done = work().then(async outcome => {
    if (poll) window.clearInterval(poll);
    job.outcome = outcome;
    // The last word of the launcher (the end event) before the console shows the result.
    if (!demo) job.progress = (await freezeProgress(appId).catch(() => null)) ?? job.progress;
    // Whatever happened, the library shows the game's state as it is now (a failed freeze leaves no record).
    await scanLibrary().catch(() => undefined);
    if (!open) notify(`${freezeTitle(mode, game.name)}: ${outcome.detail}`, { tone: outcome.ok ? "success" : "error", durationMs: outcome.ok ? undefined : 0 });
    emit();
    return outcome;
  });
  jobs.set(appId, job);
  open = true;
  focus = appId;
  emit();
  return job;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The console's state now (jobs, open, focus), outside React. */
export const freezeConsoleState = () => snapshot;

export function useFreezeConsole() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function useFreezeJob(appId: number | null | undefined): FreezeJob | undefined {
  const state = useFreezeConsole();
  return appId ? state.jobs.find(job => job.appId === appId && !job.outcome) : undefined;
}
