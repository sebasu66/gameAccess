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

/** "1:20", "12:05", "1:02:03". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
