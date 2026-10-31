import { useSyncExternalStore } from "react";

/**
 * The app's single notice (docs/GUI_DESIGN.md §4.9): results, steps and simple confirmations, bottom right.
 * There is only one at a time; a new one replaces the content of the visible one instead of stacking.
 * A good result without its own buttons closes itself after 8 s (Seba, 2026-10-31: 3 s went by before it could be
 * read; 5 to 10 s); an error never closes by itself.
 * Long blocking work (updates, catalog database, plugin) stays in the central dialog.
 */
export type NoticeTone = "ok" | "info" | "frost" | "danger" | "error";
export type NoticeActionKind = "primary" | "secondary" | "danger" | "frost";
export interface NoticeAction { label: string; kind?: NoticeActionKind; run: () => void }
export type NoticeStepState = "pending" | "running" | "done" | "failed";
export interface NoticeStep { label: string; state: NoticeStepState }
export interface NoticeGame { name: string; image?: string | null }
/** A folded section under the text: `load` gives its text the first time it is opened (a log, for instance). */
export interface NoticeDetails { label: string; load: () => Promise<string> }
export interface Notice {
  id: number;
  title: string;
  text?: string;
  tone: NoticeTone;
  game?: NoticeGame;
  actions: NoticeAction[];
  /** Closes itself after NOTICE_TIMER_MS (paused while the pointer is over it). */
  timer: boolean;
  steps?: NoticeStep[];
  details?: NoticeDetails;
  /** 0..1 for a known progress, null for work whose length is unknown; undefined hides the bar. */
  progress?: number | null;
  /** Called once when this notice leaves the screen (closed, timed out or replaced). */
  onDismiss?: () => void;
}
export type NoticeInput = Omit<Notice, "id" | "actions" | "timer"> & { actions?: NoticeAction[]; timer?: boolean };

/** How long a good result stays: the countdown circle's animation in notice.css (ga-notice-timer) lasts this. */
export const NOTICE_TIMER_MS = 8000;
const listeners = new Set<() => void>();
let current: Notice | null = null;
let nextId = 1;
let pendingConfirm: ((ok: boolean) => void) | null = null;

const emit = () => listeners.forEach(listener => listener());

function settle(previous: Notice | null) {
  if (pendingConfirm) { const resolve = pendingConfirm; pendingConfirm = null; resolve(false); }
  previous?.onDismiss?.();
}

/** Shows a notice, replacing the visible one. Without own buttons, a good result gets the timer. */
export function showNotice(input: NoticeInput): number {
  const previous = current;
  const actions = input.actions ?? [];
  const working = Boolean(input.steps?.length) || input.progress !== undefined;
  const timer = input.timer ?? (!actions.length && !working && input.tone !== "error");
  current = { ...input, id: nextId++, actions, timer };
  settle(previous);
  emit();
  return current.id;
}

/** Changes the visible notice if it is still the one with this id. */
export function updateNotice(id: number, patch: Partial<Omit<Notice, "id">>): void {
  if (!current || current.id !== id) return;
  current = { ...current, ...patch };
  emit();
}

/** Closes the visible notice (or only the one with this id). */
export function hideNotice(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  const previous = current;
  current = null;
  settle(previous);
  emit();
}

export function getNotice(): Notice | null {
  return current;
}

export function useNotice(): Notice | null {
  return useSyncExternalStore(subscribe, getNotice, getNotice);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Asks in the notice itself: Cancel + the action. Resolves false if cancelled, replaced or closed. */
export function confirmNotice(input: { game?: NoticeGame; title: string; text?: string; confirmLabel: string; cancelLabel: string; kind?: "danger" | "frost" | "primary" }): Promise<boolean> {
  return new Promise(resolve => {
    let id = 0;
    const answer = (ok: boolean) => {
      if (pendingConfirm !== resolver) return;
      pendingConfirm = null;
      resolve(ok);
      if (!ok) hideNotice(id);
    };
    id = showNotice({
      game: input.game, title: input.title, text: input.text, tone: input.kind === "frost" ? "frost" : input.kind === "primary" ? "info" : "danger", timer: false,
      actions: [{ label: input.cancelLabel, kind: "secondary", run: () => answer(false) }, { label: input.confirmLabel, kind: input.kind ?? "danger", run: () => answer(true) }],
    });
    const resolver = (ok: boolean) => resolve(ok);
    pendingConfirm = resolver;
  });
}

/** A notice that walks through steps; the caller marks each one and ends with a result. */
export function runSteps(input: { game?: NoticeGame; title: string; text?: string; steps: string[]; tone?: NoticeTone }) {
  let steps: NoticeStep[] = input.steps.map(label => ({ label, state: "pending" }));
  const id = showNotice({ game: input.game, title: input.title, text: input.text, tone: input.tone ?? "info", steps, progress: 0 });
  const progress = () => steps.filter(step => step.state === "done").length / Math.max(1, steps.length);
  return {
    id,
    set(index: number, state: NoticeStepState) {
      steps = steps.map((step, i) => (i === index ? { ...step, state } : step));
      updateNotice(id, { steps, progress: progress() });
    },
    /** Ends well: same notice, result text and the timer (or the given buttons). */
    succeed(result: { title: string; text?: string; actions?: NoticeAction[] }) {
      if (current?.id !== id) return;
      showNotice({ game: input.game, tone: "ok", ...result, timer: true });
    },
    /** Ends with an error: it stays until the player closes it. */
    fail(result: { title: string; text?: string; actions: NoticeAction[] }) {
      if (current?.id !== id) return;
      showNotice({ game: input.game, tone: "error", ...result, timer: false });
    },
  };
}
