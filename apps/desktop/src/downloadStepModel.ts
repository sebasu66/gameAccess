import type { DownloadProgressSnapshot, DownloadStepId } from "./downloadProvider";

export const STEP_ORDER: DownloadStepId[] = ["route", "probe", "server", "download", "extract", "install"];
export type StepState = "done" | "current" | "pending" | "skipped" | "failed";
export interface StepView { id: DownloadStepId; state: StepState; text: string; ms?: number; startedAt?: number }

/**
 * The sequence a download goes through (docs/TAREA-interfaz-nueva.md T12), so the player sees why it takes time to
 * start. The launcher sends it as structured data (`step` + `steps`); an older launcher only sends "Paso N de 3 · …"
 * texts, and then the sequence is worked out from the phase and that text.
 */
export function downloadSteps(snapshot: DownloadProgressSnapshot): StepView[] {
  if (snapshot.step !== undefined || snapshot.steps !== undefined) return structured(snapshot);
  return fromText(snapshot);
}

function structured(snapshot: DownloadProgressSnapshot): StepView[] {
  const done = new Map((snapshot.steps ?? []).map(step => [step.id, step]));
  const failed = snapshot.phase === "error";
  return STEP_ORDER.map(id => {
    const finished = done.get(id);
    if (finished) return { id, state: finished.state, text: finished.result, ms: finished.ms };
    if (snapshot.step?.id === id) return failed
      ? { id, state: "failed", text: snapshot.error || snapshot.step.detail }
      : { id, state: "current", text: snapshot.step.detail || snapshot.statusText || "", startedAt: snapshot.step.startedAt };
    return { id, state: snapshot.phase === "completed" ? "skipped" : "pending", text: "" };
  });
}

function fromText(snapshot: DownloadProgressSnapshot): StepView[] {
  const text = snapshot.statusText ?? "";
  const states = new Map<DownloadStepId, StepView>();
  const set = (id: DownloadStepId, state: StepState, value = "") => states.set(id, { id, state, text: value });
  const after = (id: DownloadStepId) => { for (const step of STEP_ORDER.slice(0, STEP_ORDER.indexOf(id))) if (!states.has(step)) set(step, "skipped"); };
  switch (snapshot.phase) {
    case "preparing":
      if (/probando la velocidad/i.test(text)) { set("route", "done"); set("probe", "current", text); }
      else if (/paso 1/i.test(text)) set("route", "current", text);
      else if (/paso 2/i.test(text) && /lento/i.test(text)) { set("route", "done"); set("probe", "done", text); set("server", "current"); }
      else if (/paso 2/i.test(text)) { set("route", "done", text); set("probe", "skipped"); set("server", "current"); }
      else if (/paso 3/i.test(text)) { set("route", "done"); set("server", "current", text); }
      break;
    case "downloading": case "paused": after("download"); set("download", "current", text); break;
    case "decompressing": after("download"); set("download", "done"); set("extract", "current", text); break;
    case "installing": after("download"); set("download", "done"); set("extract", "done"); set("install", "current", text); break;
    case "completed": for (const id of STEP_ORDER) set(id, id === "download" || id === "extract" ? "done" : "skipped"); break;
    case "error": { const at = STEP_ORDER.find(id => states.get(id)?.state === "current") ?? "download"; after(at); set(at, "failed", snapshot.error || text); break; }
    default: break;
  }
  return STEP_ORDER.map(id => states.get(id) ?? { id, state: "pending", text: "" });
}

/** Whether the transfer itself has begun: from then on the row shows its bars, speed and time left. */
export function transferStarted(snapshot: DownloadProgressSnapshot): boolean {
  if (["downloading", "decompressing", "installing", "completed"].includes(snapshot.phase)) return true;
  // Paused before anything arrived is still the preparation.
  return snapshot.phase === "paused" && (snapshot.bytesDownloaded ?? 0) > 0;
}

/** Whether the download itself (or what follows it) is running: the preparation steps are behind. */
export function stepsStarted(steps: StepView[]): boolean {
  return steps.some(step => ["download", "extract", "install"].includes(step.id) && (step.state === "current" || step.state === "done"));
}

/**
 * The steps worth showing in the timeline. While the download is prepared: the running step and the next one, or the
 * whole sequence when expanded. Once the download has begun, its progress has its own block, so the timeline lists only
 * the steps still to come (pending); a step before the running one that never ran will not run any more either.
 */
export function timelineSteps(steps: StepView[], expanded: boolean): StepView[] {
  const at = steps.findIndex(step => step.state === "current" || step.state === "failed");
  if (stepsStarted(steps)) return at < 0 ? [] : steps.slice(at + 1).filter(step => step.state === "pending");
  if (expanded || at < 0) return steps;
  return steps.slice(at, at + 2);
}

/** "1:20", "12:05", "1:02:03". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
