/**
 * The download's log in the wizard (vault/Rediseño de navegación.md §5.10): what happened, with its time and level,
 * kept by the app from the Download Manager's own updates. A line is written when something changes (a step starts,
 * ends, is not needed or fails; the download pauses, goes on, stops or ends; a torrent leaves the race), never for
 * each progress tick.
 */
import type { DownloadProgressSnapshot, StepFacts } from "./downloadProvider";
import { formatDownloadBytes } from "./downloadSize";
import { translate } from "./i18n";
import { stageOfStep, type StageId } from "./downloadWizard";

export type EventLevel = "INF" | "OK" | "WRN" | "ERR";
export interface DownloadEvent { at: number; level: EventLevel; stage: StageId; text: string }
export const MAX_EVENTS = 200;

const STEP_NAME = { pick: "dlStepPick", route: "dlStepRoute", probe: "dlStepProbe", server: "dlStepServer", download: "dlStepTransfer", extract: "dlStepExtract", install: "dlStepInstall", signin: "dlStepSignin", handoff: "dlStepHandoff", adopt: "dlStepAdopt", dialog: "dlStepSteamDialog" } as const;
const PHASE_STAGE: Partial<Record<DownloadProgressSnapshot["phase"], StageId>> = {
  queued: "prepare", preparing: "prepare", downloading: "download", decompressing: "install", installing: "configure", completed: "ready",
};

function stageNow(snapshot: DownloadProgressSnapshot): StageId {
  if (snapshot.step) return stageOfStep(snapshot.step.id);
  return PHASE_STAGE[snapshot.phase] ?? (snapshot.resumeStep === "extract" ? "install" : (snapshot.bytesDownloaded ?? 0) > 0 ? "download" : "prepare");
}

/** A step's specifics as log lines (the stage's left side stays a readable summary): only what is new or changed. */
export function factLines(before: StepFacts | undefined, facts: StepFacts | undefined): Array<{ level: EventLevel; text: string }> {
  if (!facts) return [];
  const changed = (...keys: (keyof StepFacts)[]) => keys.some(key => facts[key] !== undefined && facts[key] !== before?.[key]);
  const lines: Array<{ level: EventLevel; text: string }> = [];
  if (changed("account")) lines.push({ level: "INF", text: translate("dlLogAccount", { account: facts.account === "QR" ? translate("dlFactAccountQr") : facts.account ?? "" }) });
  if (changed("from")) lines.push({ level: "INF", text: translate("dlLogFrom", { file: facts.from ?? "" }) });
  if (changed("folder", "drive") && facts.folder) lines.push({ level: "INF", text: facts.drive ? translate("dlLogFolderOn", { folder: facts.folder, drive: facts.drive }) : translate("dlLogFolder", { folder: facts.folder }) });
  if (changed("library") && facts.library) lines.push({ level: "INF", text: translate("dlLogLibrary", { library: facts.library }) });
  if (changed("freeBytes", "neededBytes") && typeof facts.freeBytes === "number" && typeof facts.neededBytes === "number") {
    const short = facts.freeBytes < facts.neededBytes;
    lines.push({ level: short ? "ERR" : "INF", text: translate(short ? "dlLogRoomShort" : "dlLogRoom", {
      drive: facts.drive ?? "", free: formatDownloadBytes(facts.freeBytes), needed: formatDownloadBytes(facts.neededBytes) }) });
  }
  return lines;
}

/** The lines this update adds to the log. */
export function downloadEvents(previous: DownloadProgressSnapshot | undefined, next: DownloadProgressSnapshot, now = Date.now()): DownloadEvent[] {
  const events: DownloadEvent[] = [];
  const add = (level: EventLevel, stage: StageId, text: string) => { if (text.trim()) events.push({ at: now, level, stage, text: text.trim() }); };
  const name = (id: keyof typeof STEP_NAME) => translate(STEP_NAME[id]);
  // A new download (not one the app found again after a restart).
  if (!previous && next.phase === "queued") add("INF", "prepare", translate("dlLogQueued"));
  const before = new Map((previous?.steps ?? []).map(step => [step.id, step.state]));
  // What a step worked with (which file, which folder and disk, the space): the log tells it, before how the step ended.
  const knownFacts = new Map([...(previous?.steps ?? []), ...(previous?.step ? [previous.step] : [])].map(step => [step.id, step.facts]));
  for (const step of next.steps ?? []) for (const line of factLines(knownFacts.get(step.id), step.facts)) add(line.level, stageOfStep(step.id), line.text);
  for (const step of next.steps ?? []) {
    if (before.get(step.id) === step.state) continue;
    const stage = stageOfStep(step.id);
    if (step.state === "done") add("OK", stage, step.result ? `${name(step.id)}: ${step.result}` : name(step.id));
    else if (step.state === "failed") add("ERR", stage, step.result ? `${name(step.id)}: ${step.result}` : name(step.id));
    else if (step.result && previous) add("INF", stage, `${name(step.id)}: ${step.result}`);  // not needed, and why
  }
  if (next.step && next.step.id !== previous?.step?.id) {
    add("INF", stageOfStep(next.step.id), next.step.detail ? `${name(next.step.id)}: ${next.step.detail}` : name(next.step.id));
  }
  if (next.step) for (const line of factLines(knownFacts.get(next.step.id), next.step.facts)) add(line.level, stageOfStep(next.step.id), line.text);
  if (typeof next.checkPercent === "number" && typeof previous?.checkPercent !== "number") add("INF", "download", translate("dlLogChecking"));
  const wasRacing = new Map((previous?.race ?? []).map(lane => [lane.title, lane.state]));
  for (const lane of next.race ?? []) {
    if (lane.state === "out" && wasRacing.get(lane.title) !== "out") add("WRN", "prepare", translate("dlLogRaceOut", { title: lane.title || "?" }));
  }
  if (previous && previous.phase !== next.phase) {
    const stage = stageNow(next);
    if (next.phase === "paused") add("WRN", stage, translate("dlLogPaused"));
    else if (previous.phase === "paused" && !["cancelled", "cancelling", "error"].includes(next.phase)) add("INF", stage, translate("dlLogResumed"));
    if (next.phase === "error") add("ERR", stage, next.error || next.statusText || translate("dlLogFailed"));
    else if (next.phase === "interrupted") add("WRN", stage, translate("dlLogInterrupted"));
    else if (next.phase === "cancelled") add("WRN", stage, translate("dlLogCancelled"));
    else if (next.phase === "completed") add("OK", "ready", translate("dlLogReady"));
  }
  return events;
}

/** The log with this update's lines added, newest last, at most MAX_EVENTS. */
export function appendEvents(log: readonly DownloadEvent[], previous: DownloadProgressSnapshot | undefined, next: DownloadProgressSnapshot, now = Date.now()): DownloadEvent[] {
  const added = downloadEvents(previous, next, now);
  return added.length ? [...log, ...added].slice(-MAX_EVENTS) : log as DownloadEvent[];
}
