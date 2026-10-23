/**
 * The app's one central dialog. It shows two kinds of things, one at a time:
 *
 * - Tasks: long processes the player has to wait for (installing a new version, updating the catalog database,
 *   syncing the download plugin's sources). A task has steps with progress; while it runs the app cannot be used.
 *   It only appears when it lasts more than a moment, so a quick check does not flash on screen.
 * - Announcements: the welcome on the first run and later news (new versions, features). Each one is shown once.
 *
 * Anything that needs the player to wait goes through `runTask` (or `beginTask` for code that reports by itself);
 * nothing long runs hidden in the background.
 */

export type StepState = "pending" | "running" | "done" | "skipped" | "failed";

export interface TaskStep {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  done?: number;
  total?: number;
  unit?: "bytes" | "items";
  startedAt?: number;
}

export interface TaskView {
  id: number;
  title: string;
  steps: TaskStep[];
  /** Set when the task ended with a failure the player has to acknowledge. */
  failure?: string;
  canRetry?: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  date?: string;
}

export interface DialogState {
  task: TaskView | null;
  /** The task is drawn (it has lasted longer than SHOW_AFTER_MS, or it failed). */
  taskVisible: boolean;
  announcements: Announcement[];
}

export const SHOW_AFTER_MS = 600;

type Listener = (state: DialogState) => void;

export interface StepRunner {
  id: string;
  label: string;
  /** Resolves "skipped" when there was nothing to do; throws to mark the step failed. */
  run: (progress: (done: number, total?: number, detail?: string, unit?: TaskStep["unit"]) => void) => Promise<void | "skipped">;
}

export interface TaskHandle {
  start(stepId: string, detail?: string): void;
  progress(stepId: string, done: number, total?: number, detail?: string, unit?: TaskStep["unit"]): void;
  finish(stepId: string, state?: Exclude<StepState, "pending" | "running">, detail?: string): void;
  /** Keep the dialog open with this failure until the player chooses to continue or (when allowed) retry. */
  fail(message: string, canRetry?: boolean): Promise<"continue" | "retry">;
  end(): void;
}

class CentralDialog {
  private state: DialogState = { task: null, taskVisible: false, announcements: [] };
  private listeners = new Set<Listener>();
  private chain: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private acknowledge: ((choice: "continue" | "retry") => void) | null = null;
  /** Who showed the announcements on screen, so each caller hears about the ones it showed. */
  private closers: Array<{ ids: string[]; onClosed?: (ids: string[]) => void }> = [];

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): DialogState { return this.state; }

  private set(next: Partial<DialogState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }

  private updateStep(stepId: string, change: Partial<TaskStep>): void {
    const task = this.state.task;
    if (!task) return;
    this.set({ task: { ...task, steps: task.steps.map(step => step.id === stepId ? { ...step, ...change } : step) } });
  }

  /** Starts a task the caller reports on step by step. Tasks run one after another. */
  beginTask(title: string, steps: Array<{ id: string; label: string }>): Promise<TaskHandle> {
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    const ready = this.chain.then(() => {
      this.set({ task: { id: ++this.sequence, title, steps: steps.map(step => ({ ...step, state: "pending" })) }, taskVisible: false });
      this.showTimer = setTimeout(() => this.set({ taskVisible: true }), SHOW_AFTER_MS);
      const handle: TaskHandle = {
        start: (stepId, detail) => this.updateStep(stepId, { state: "running", detail, startedAt: Date.now(), done: undefined, total: undefined }),
        progress: (stepId, done, total, detail, unit) => this.updateStep(stepId, { state: "running", done, total, unit, ...(detail !== undefined ? { detail } : {}) }),
        finish: (stepId, state = "done", detail) => this.updateStep(stepId, { state, ...(detail !== undefined ? { detail } : {}) }),
        fail: (message, canRetry = false) => new Promise<"continue" | "retry">(resolve => {
          if (this.showTimer) { clearTimeout(this.showTimer); this.showTimer = null; }
          this.acknowledge = resolve;
          const task = this.state.task;
          if (task) this.set({ task: { ...task, failure: message, canRetry }, taskVisible: true });
        }),
        end: () => {
          if (this.showTimer) { clearTimeout(this.showTimer); this.showTimer = null; }
          this.set({ task: null, taskVisible: false });
          release();
        },
      };
      return handle;
    });
    this.chain = ready.then(() => turn);
    return ready;
  }

  /**
   * Runs the steps in order. A failed step does not stop the next ones; the failures are shown at the end.
   * With `canRetry`, the player can run the failed steps again from the failure.
   */
  async runTask(title: string, steps: StepRunner[], options: { canRetry?: boolean } = {}): Promise<{ failed: string[] }> {
    const task = await this.beginTask(title, steps);
    let pending = steps;
    let failed: string[] = [];
    for (;;) {
      const again: StepRunner[] = [];
      failed = [];
      for (const step of pending) {
        task.start(step.id);
        try {
          const result = await step.run((done, total, detail, unit) => task.progress(step.id, done, total, detail, unit));
          task.finish(step.id, result === "skipped" ? "skipped" : "done");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          task.finish(step.id, "failed", message);
          failed.push(`${step.label}: ${message}`);
          again.push(step);
        }
      }
      if (!failed.length || (await task.fail(failed.join("\n"), options.canRetry)) !== "retry") break;
      pending = again;
    }
    task.end();
    return { failed };
  }

  /** The player read the failure and chose what to do; the task that failed decides what happens next. */
  answerFailure(choice: "continue" | "retry"): void {
    const task = this.state.task;
    const answer = this.acknowledge;
    this.acknowledge = null;
    if (task) this.set({ task: { ...task, failure: undefined, canRetry: undefined } });
    answer?.(choice);
  }

  /** Announcements already on screen stay: the new ones are added after them (news must not hide an update notice). */
  showAnnouncements(announcements: Announcement[], onClosed?: (ids: string[]) => void): void {
    const shown = new Set(this.state.announcements.map(item => item.id));
    const added = announcements.filter(item => !shown.has(item.id));
    if (!added.length) return;
    this.closers.push({ ids: added.map(item => item.id), onClosed });
    this.set({ announcements: [...this.state.announcements, ...added] });
  }

  closeAnnouncements(): void {
    const closers = this.closers;
    this.closers = [];
    this.set({ announcements: [] });
    for (const { ids, onClosed } of closers) onClosed?.(ids);
  }
}

export const centralDialog = new CentralDialog();
export { CentralDialog };
