import { useSyncExternalStore } from "react";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { demoFreeze } from "./devDemo/freezeDemo";
import { uiDemo } from "./devDemo/uiDemo";
import { formatBytes } from "./GenericDownloadProgress";
import { translate } from "./i18n";
import { libraryDemo, libraryScanState, scanLibrary } from "./libraryScan";
import { freezeProgress, freezeSignal, hasTauriRuntime, type FreezeProgress } from "./native";
import { confirmNotice, hideNotice, showNotice, type NoticeAction } from "./notice/notice";
import { noticeGame } from "./notice/noticeGame";
import type { FreezeMode } from "./FreezeDialog";
import type { CatalogGame } from "./types";
import type { TranslationKey } from "./i18n";
import { clock } from "./FreezeConsole";

/**
 * Freezing a big game takes minutes. The work belongs to the app, not to what asked for it: one freeze or thaw at a
 * time (the launcher holds a lock too), the others wait in a queue and start by themselves; each can be cancelled
 * (the launcher puts the game back as it was). While a game is being played the work waits (pause) and goes on when
 * it ends. The job is shown in the game's row of the Library Manager or in the floating console, from the launcher's
 * progress read a few times a second; its result is told in the app's notice, and when the notice goes, so does the
 * job. After a closed app, the launcher puts every cut freeze back in a safe state and the notice says what happened.
 *
 * Moving a linked game into the library is the same kind of work (minutes of disk, one at a time, cancellable) and is
 * a job of this same queue with mode "move": the launcher writes its progress in the same file (mover.py), so the
 * game's row, its log, the console and the notice show it the same way.
 */
export type JobMode = FreezeMode | "move";

/** What each kind of job is called (the row's status, the log's group, the console). */
export const jobLabelKey = (mode: JobMode): TranslationKey =>
  mode === "move" ? "freezeConsoleMove" : mode === "thaw" ? "freezeConsoleThaw" : mode === "deep" ? "freezeConsoleDeep" : "freezeConsoleFreeze";
export const jobCancelKey = (mode: JobMode): TranslationKey => mode === "move" ? "moveCancel" : mode === "thaw" ? "thawCancel" : "freezeCancel";
export interface FreezeOutcome { ok: boolean; detail: string; cancelled?: boolean }
export interface FreezeJob {
  appId: number; name: string; mode: JobMode; game: CatalogGame; startedAt: number;
  done: Promise<FreezeOutcome>; progress?: FreezeProgress; outcome?: FreezeOutcome;
  /** Waiting for the one going on to end. */
  queued?: boolean;
  /** Asked to stop: the launcher is putting the game back. */
  cancelling?: boolean;
}

const POLL_MS = 400;
const jobs = new Map<number, FreezeJob>();     // waiting, running and finished, until dismissed
const starters = new Map<number, () => void>(); // how each waiting job starts
const listeners = new Set<() => void>();
// Games whose job is shown in place (the Library Manager's row of the game): the floating console leaves them out.
const inline = new Map<number, number>();
type Snapshot = { jobs: FreezeJob[]; open: boolean; focus: number | null; inline: number[]; paused: boolean };
let snapshot: Snapshot = { jobs: [], open: false, focus: null, inline: [], paused: false };
let open = false;
let focus: number | null = null;
let paused = false;
const demoCancels = new Set<number>();
const settles = new Map<number, (outcome: FreezeOutcome) => void>();
const emit = () => {
  snapshot = { jobs: [...jobs.values()].map(job => ({ ...job })), open, focus, inline: [...inline.keys()], paused };
  listeners.forEach(listener => listener());
};
const isDemo = () => (uiDemo() || libraryDemo()) && !hasTauriRuntime();

export const freezeTitle = (mode: JobMode, name: string) =>
  translate(mode === "move" ? "moveTitle" : mode === "thaw" ? "thawTitle" : mode === "deep" ? "deepFreezeTitle" : "freezeTitle", { name });

/** The job of a game that is waiting or working (a finished one does not stop a new freeze). */
export function freezeJob(appId: number): FreezeJob | undefined {
  const job = jobs.get(appId);
  return job && !job.outcome ? job : undefined;
}

/** The one job working now, if any. */
export function runningFreezeJob(): FreezeJob | undefined {
  return [...jobs.values()].find(job => !job.outcome && !job.queued);
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

/** A view that shows this game's job in place (while mounted): the floating console leaves it out. Returns the
 *  function that ends it. */
export function hostFreezeJob(appId: number): () => void {
  inline.set(appId, (inline.get(appId) ?? 0) + 1);
  emit();
  return () => {
    const count = (inline.get(appId) ?? 1) - 1;
    if (count > 0) inline.set(appId, count); else inline.delete(appId);
    emit();
  };
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

/** Start the next job in the queue when nothing is working. */
function pump(): void {
  if (runningFreezeJob()) return;
  const next = [...jobs.values()].find(job => job.queued && !job.outcome);
  if (next) starters.get(next.appId)?.();
}

const resultTitle = (mode: JobMode, outcome: FreezeOutcome) =>
  translate(mode === "move" ? (outcome.cancelled ? "lmMoveCancelled" : outcome.ok ? "lmMoveComplete" : "lmMoveIncomplete")
    : outcome.cancelled ? (mode === "thaw" ? "lmThawCancelled" : "lmFreezeCancelled")
    : outcome.ok ? (mode === "thaw" ? "lmThawComplete" : mode === "deep" ? "lmDeepFreezeComplete" : "lmFreezeComplete") : "lmFreezeIncomplete");

/** The result, told like every result in the app's notice: an OK that presses itself after a moment (an error waits
 *  for it). When the notice goes, so does the job (its row in the Library Manager folds). */
function announce(job: FreezeJob, outcome: FreezeOutcome): void {
  const good = outcome.ok || Boolean(outcome.cancelled);
  showNotice({
    game: noticeGame(job.game), title: resultTitle(job.mode, outcome), text: outcome.detail,
    tone: outcome.cancelled ? "info" : outcome.ok ? (job.mode === "move" ? "ok" : "frost") : "error", timer: good, onDismiss: () => dismissFreezeJob(job.appId),
    actions: [{ label: translate("noticeOk"), kind: outcome.ok ? (job.mode === "move" ? "primary" : "frost") : "secondary", run: () => hideNotice() }],
  });
}

/** Freeze (either level) or thaw a game: at once when nothing else is working, else queued after it. */
export function startFreezeJob(game: CatalogGame, mode: JobMode, options: { resume?: boolean } = {}): FreezeJob {
  const appId = game.app_id ?? game.id;
  const existing = freezeJob(appId);
  if (existing) { openFreezeConsole(appId); return existing; }
  let settle: (outcome: FreezeOutcome) => void = () => undefined;
  const job: FreezeJob = { appId, name: game.name, mode, game, startedAt: Date.now(), done: new Promise(resolve => { settle = resolve; }) };
  settles.set(appId, settle);
  const demo = isDemo();
  const run = () => {
    starters.delete(appId);
    job.queued = false;
    job.startedAt = Date.now();
    // The launcher's progress file; an older one (from the last freeze of this game) is not this job's.
    const poll = demo ? 0 : window.setInterval(() => {
      void freezeProgress(appId).then(progress => {
        if (!progress || progress.started_at * 1000 < job.startedAt - 5000 || jobs.get(appId) !== job) return;
        job.progress = progress;
        emit();
      }).catch(() => undefined);
    }, POLL_MS);
    const work = async (): Promise<FreezeOutcome> => {
      if (mode === "move") return demo ? demoMove() : moveIntoLibrary(appId, Boolean(options.resume));
      try {
        const result = (demo ? await demoFreeze(mode as FreezeMode, progress => { job.progress = progress; emit(); }, () => demoCancels.has(appId))
          : mode === "thaw" ? await digitalProcessManager.thaw(game) : await digitalProcessManager.freeze(game, mode as "freeze" | "deep")) as { cancelled?: boolean; frozen?: { stored_bytes?: number; original_bytes?: number } };
        if (result.cancelled) return { ok: false, cancelled: true, detail: translate(mode === "thaw" ? "lmThawCancelledText" : "lmFreezeCancelledText") };
        const frozen = result.frozen;
        return { ok: true, detail: frozen ? translate("freezeDone", { stored: formatBytes(frozen.stored_bytes), original: formatBytes(frozen.original_bytes) }) : translate("thawDone") };
      } catch (error) {
        return { ok: false, detail: translate("freezeFailed", { error: error instanceof Error ? error.message : String(error) }) };
      }
    };
    // The demo move borrows the freeze's simulated progress.
    const demoMove = async (): Promise<FreezeOutcome> => {
      const result = await demoFreeze("freeze", progress => { job.progress = progress; emit(); }, () => demoCancels.has(appId)) as { cancelled?: boolean };
      return result.cancelled ? { ok: false, cancelled: true, detail: translate("lmMoveCancelledText") } : { ok: true, detail: translate("moveDone", { size: formatBytes(job.progress?.total_bytes ?? 0), time: clock((Date.now() - job.startedAt) / 1000) }) };
    };
    void work().then(async outcome => {
      if (poll) window.clearInterval(poll);
      demoCancels.delete(appId);
      job.outcome = outcome;
      job.cancelling = false;
      // The last word of the launcher (the end event) before the result shows.
      if (!demo) job.progress = (await freezeProgress(appId).catch(() => null)) ?? job.progress;
      // Whatever happened, the library shows the game's state as it is now (a failed freeze leaves no record).
      await scanLibrary().catch(() => undefined);
      announce(job, outcome);
      emit();
      settles.delete(appId);
      settle(outcome);
      pump();
    });
    emit();
  };
  const ahead = runningFreezeJob();
  jobs.set(appId, job);
  if (ahead) {
    job.queued = true;
    starters.set(appId, run);
    showNotice({ game: noticeGame(game), title: translate("lmFreezeQueuedTitle"), text: translate("lmFreezeQueuedText", { name: ahead.name }), tone: "frost" });
  } else run();
  open = true;
  focus = appId;
  emit();
  return job;
}

/** A linked game moved into the games folder (the launcher's library batch, which asks for the parent's key first). */
async function moveIntoLibrary(appId: number, resume: boolean): Promise<FreezeOutcome> {
  try {
    const { results } = await digitalProcessManager.libraryBatch(resume ? "linked_move_resume" : "linked_move", [appId]) as { results?: Array<{ ok: boolean; cancelled?: boolean; error?: string; moved_bytes?: number; seconds?: number }> };
    const row = results?.[0];
    if (row?.cancelled) return { ok: false, cancelled: true, detail: translate("lmMoveCancelledText") };
    if (!row?.ok) return { ok: false, detail: translate("freezeFailed", { error: row?.error ?? "" }) };
    return { ok: true, detail: translate("moveDone", { size: formatBytes(row.moved_bytes ?? 0), time: clock(row.seconds ?? 0) }) };
  } catch (error) {
    return { ok: false, detail: translate("freezeFailed", { error: error instanceof Error ? error.message : String(error) }) };
  }
}

/** The half-made copy of a move cut short is deleted; the game stays linked where it was. */
export async function discardMove(game: CatalogGame): Promise<void> {
  const appId = game.app_id ?? game.id;
  try {
    const { results } = await digitalProcessManager.libraryBatch("linked_move_discard", [appId]) as { results?: Array<{ ok: boolean; error?: string }> };
    if (results?.[0] && !results[0].ok) throw new Error(results[0].error);
    showNotice({ game: noticeGame(game), title: translate("moveDiscarded"), tone: "info", timer: true });
  } catch (error) {
    showNotice({ game: noticeGame(game), title: translate("lmMoveIncomplete"), text: translate("freezeFailed", { error: error instanceof Error ? error.message : String(error) }), tone: "error" });
  }
  await scanLibrary().catch(() => undefined);
}

/** Stop a game's freeze or thaw: a queued one just leaves the queue; one working is asked to put the game back. */
export function cancelFreezeJob(appId: number): void {
  const job = freezeJob(appId);
  if (!job || job.cancelling) return;
  if (job.queued) {
    starters.delete(appId);
    job.outcome = { ok: false, cancelled: true, detail: translate("lmFreezeUnqueuedText") };
    jobs.delete(appId);
    settles.get(appId)?.(job.outcome);
    settles.delete(appId);
    emit();
    return;
  }
  job.cancelling = true;
  if (isDemo()) demoCancels.add(appId); else void freezeSignal(appId, "cancel").catch(() => undefined);
  emit();
}

/** A game starts: the freeze working meanwhile waits (it takes every core and the disk) until that game ends. */
export function pauseFreezesWhilePlaying(): void {
  if (!runningFreezeJob() || paused) return;
  paused = true;
  void freezeSignal(0, "pause").catch(() => undefined);
  emit();
}

export function resumeFreezes(): void {
  if (!paused) return;
  paused = false;
  void freezeSignal(0, "resume").catch(() => undefined);
  emit();
}

const stub = (appId: number): CatalogGame => {
  const entry = libraryScanState().games.find(game => game.app_id === appId);
  return { id: appId, app_id: appId, name: entry?.name ?? `#${appId}` } as CatalogGame;
};

/** After the app was closed in the middle of a freeze: the launcher has put each one back in a safe state; say what
 *  happened, one notice after the other, and offer what makes sense (go on, undo, try again). A freeze still running
 *  in its own process is followed again. */
export async function recoverFreezes(): Promise<void> {
  if (isDemo() || !hasTauriRuntime()) return;
  let recovered: Array<{ app_id: number; action: string; percent: number; outcome: string; error?: string }> = [];
  try { recovered = ((await digitalProcessManager.freezeRecover()) as { recovered?: typeof recovered }).recovered ?? []; } catch { return; }
  await freezeSignal(0, "resume").catch(() => undefined);   // a pause left by the closed app
  const notices: Array<() => void> = [];
  const next = () => notices.shift()?.();
  for (const item of recovered) {
    const game = stub(item.app_id);
    const percent = String(Math.floor(item.percent));
    if (item.outcome === "running") { follow(game, item.action); continue; }
    const actions: NoticeAction[] = [{ label: translate("noticeOk"), kind: "secondary", run: () => hideNotice() }];
    let text = "", tone: "frost" | "info" | "error" = "info", timer = false;
    if (item.outcome === "resumable") {
      text = translate("freezeCutResumable", { percent });
      actions.splice(0, 1, { label: translate("freezeCutUndo"), kind: "secondary", run: () => { hideNotice(); startFreezeJob(game, "thaw"); } },
        { label: translate("freezeCutResume"), kind: "frost", run: () => { hideNotice(); startFreezeJob(game, "freeze"); } });
    } else if (item.outcome === "discarded") {
      text = translate("freezeCutDiscarded", { percent });
      actions.push({ label: translate("freezeCutAgain"), kind: "frost", run: () => { hideNotice(); startFreezeJob(game, "deep"); } });
    } else if (item.action === "move") {
      if (item.outcome === "resumable") {
        text = translate("moveCutResumable", { percent });
        actions.splice(0, 1, { label: translate("moveDiscard"), kind: "secondary", run: () => { hideNotice(); void discardMove(game); } },
          { label: translate("moveResume"), kind: "primary", run: () => { hideNotice(); startFreezeJob(game, "move", { resume: true }); } });
      } else if (item.outcome === "restored" || item.outcome === "completed") { text = translate(item.outcome === "restored" ? "moveCutRestored" : "moveCutCompleted", { percent }); timer = true; }
      else { text = translate("freezeFailed", { error: item.error ?? "" }); tone = "error"; }
    } else if (item.outcome === "completed") {
      text = translate("freezeCutCompleted"); tone = "frost"; timer = true;
    } else if (item.outcome === "retry") {
      text = translate("freezeCutThaw", { percent });
      actions.push({ label: translate("retry"), kind: "frost", run: () => { hideNotice(); startFreezeJob(game, "thaw"); } });
    } else {
      text = translate("freezeFailed", { error: item.error ?? "" }); tone = "error";
    }
    notices.push(() => showNotice({ game: noticeGame(game), title: translate(item.action === "move" ? "moveCutTitle" : "freezeCutTitle", { name: game.name }), text, tone, timer, actions, onDismiss: () => window.setTimeout(next, 300) }));
  }
  if (recovered.some(item => item.outcome !== "running")) void scanLibrary().catch(() => undefined);
  next();
}

/** A freeze the launcher is still doing in its own process (the app was reopened meanwhile): shown until it ends. */
function follow(game: CatalogGame, action: string): void {
  const appId = game.app_id ?? game.id;
  const mode: JobMode = action === "move" ? "move" : action === "deep" ? "deep" : action.startsWith("thaw") ? "thaw" : "freeze";
  let settle: (outcome: FreezeOutcome) => void = () => undefined;
  const job: FreezeJob = { appId, name: game.name, mode, game, startedAt: 0, done: new Promise(resolve => { settle = resolve; }) };
  jobs.set(appId, job);
  const poll = window.setInterval(() => {
    void freezeProgress(appId).then(async progress => {
      if (!progress) return;
      job.progress = progress;
      if (progress.finished && !job.outcome) {
        window.clearInterval(poll);
        const end = progress.events.at(-1);
        const outcome: FreezeOutcome = progress.cancelled ? { ok: false, cancelled: true, detail: translate(mode === "move" ? "lmMoveCancelledText" : "lmFreezeCancelledText") }
          : progress.ok && mode === "move" ? { ok: true, detail: translate("moveDone", { size: formatBytes(Number(end?.moved ?? 0)), time: clock(Number(end?.seconds ?? 0)) }) }
          : progress.ok ? { ok: true, detail: end?.stored != null ? translate("freezeDone", { stored: formatBytes(Number(end.stored)), original: formatBytes(Number(end.original)) }) : translate("thawDone") }
          : { ok: false, detail: translate("freezeFailed", { error: String(end?.error ?? "") }) };
        job.outcome = outcome;
        await scanLibrary().catch(() => undefined);
        announce(job, outcome);
        settle(outcome);
        pump();
      }
      emit();
    }).catch(() => undefined);
  }, POLL_MS);
  emit();
}

/** Closing the app with a freeze going on asks first; on yes the work is cancelled (the game goes back as it was)
 *  and the app closes once it has stopped, or after a while at most (what is left is put right when it reopens). */
export function guardAppClose(): void {
  if (!hasTauriRuntime()) return;
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const window = getCurrentWindow();
    void window.onCloseRequested(async event => {
      const working = runningFreezeJob();
      // A move is not cancelled by closing: what it copied is kept and it goes on from there (recoverFreezes).
      if (working?.mode === "move" && ![...jobs.values()].some(job => job.queued && job.mode !== "move")) return;
      if (!working && ![...jobs.values()].some(job => job.queued)) return;
      event.preventDefault();
      const ok = await confirmNotice({ game: working ? noticeGame(working.game) : undefined, title: translate("freezeCloseTitle"), text: translate("freezeCloseText"),
        confirmLabel: translate("freezeCloseConfirm"), cancelLabel: translate("freezeCloseKeep"), kind: "danger" });
      if (!ok) return;
      hideNotice();
      [...jobs.values()].filter(job => job.queued).forEach(job => cancelFreezeJob(job.appId));
      if (working && working.mode !== "move") {
        cancelFreezeJob(working.appId);
        await Promise.race([working.done, new Promise(resolve => setTimeout(resolve, 20000))]);
      }
      await window.destroy();
    });
  }).catch(() => undefined);
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

/** The job of a game, waiting, working or finished and not dismissed yet. */
export function useFreezeJobView(appId: number | null | undefined): FreezeJob | undefined {
  const state = useFreezeConsole();
  return appId ? state.jobs.find(job => job.appId === appId) : undefined;
}

export function useFreezeJob(appId: number | null | undefined): FreezeJob | undefined {
  const state = useFreezeConsole();
  return appId ? state.jobs.find(job => job.appId === appId && !job.outcome) : undefined;
}
