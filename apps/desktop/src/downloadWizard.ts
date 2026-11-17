/**
 * The download as five stages one after the other (vault/Rediseño de navegación.md §5.10, RN9): prepare, download,
 * install, configure and ready. Each stage gathers the launcher's own steps (game_download_manager/steps.py), so what
 * the wizard shows is what the Download Manager reports, never a script: the race between sources, the route, the
 * transfer, the unpacking and the setup that leaves the game ready to run.
 */
import type { DownloadProgressSnapshot, DownloadStepId, StepFacts } from "./downloadProvider";
import { downloadBars } from "./downloadBars";
import { downloadSteps, isSteamDownload, transferStarted, type StepState, type StepView } from "./downloadStepModel";

export type StageId = "prepare" | "download" | "install" | "configure" | "ready";
export type StageState = "done" | "current" | "pending" | "failed";
/** A line inside a stage: a launcher step, or what the stage is doing when no step names it (connecting, checking). */
export interface WizardSub { key: string; state: StepState; title: string; text: string; ms?: number; startedAt?: number; percent?: number; facts?: StepFacts }
export interface WizardStage { id: StageId; state: StageState; subs: WizardSub[]; percent?: number }

export const STAGE_STEPS: Readonly<Record<StageId, readonly DownloadStepId[]>> = {
  prepare: ["pick", "route", "probe", "server", "signin", "dialog"], download: ["download"], install: ["extract", "handoff"], configure: ["install", "adopt"], ready: [],
};
export const STAGE_ORDER: readonly StageId[] = ["prepare", "download", "install", "configure", "ready"];
export const STAGE_TITLES = { prepare: "dlStagePrepare", download: "dlStageDownload", install: "dlStageInstall", configure: "dlStageConfigure", ready: "dlStageReady" } as const;
export const STAGE_HINTS = { prepare: "dlStagePrepareHint", download: "dlStageDownloadHint", install: "dlStageInstallHint", configure: "dlStageConfigureHint", ready: "dlStageReadyHint" } as const;
/** A free Steam game: the same five stages, said for what happens to it (sign in, hand it to Steam, Steam takes it). */
export const STEAM_STAGE_HINTS = { prepare: "dlStagePrepareHintSteam", download: "dlStageDownloadHint", install: "dlStageInstallHintSteam", configure: "dlStageConfigureHintSteam", ready: "dlStageReadyHintSteam" } as const;
const STEP_TITLE: Record<DownloadStepId, string> = { pick: "dlStepPick", route: "dlStepRoute", probe: "dlStepProbe", server: "dlStepServer", download: "dlStepTransfer", extract: "dlStepExtract", install: "dlStepInstall",
  signin: "dlStepSignin", handoff: "dlStepHandoff", adopt: "dlStepAdopt", dialog: "dlStepSteamDialog" };

/** What the stage's steps worked with, together (a later step's value wins): shown with the stage's figures. */
export function stageFacts(stage: WizardStage): StepFacts {
  return Object.assign({}, ...stage.subs.map(sub => sub.facts ?? {}));
}

export function stageOfStep(id: DownloadStepId): StageId {
  return STAGE_ORDER.find(stage => STAGE_STEPS[stage].includes(id)) ?? "download";
}

/** The stage the download is at, from its running or failed step, else from its phase. */
function stageAt(snapshot: DownloadProgressSnapshot, steps: StepView[]): number {
  const live = steps.find(step => step.state === "failed") ?? steps.find(step => step.state === "current");
  if (live) return STAGE_ORDER.indexOf(stageOfStep(live.id));
  switch (snapshot.phase) {
    case "completed": return 4;
    case "installing": return 3;
    case "decompressing": return 2;
    case "downloading": return 1;
    case "paused": return transferStarted(snapshot) ? 1 : 0;
    case "error": case "interrupted": case "cancelled":
      return snapshot.resumeStep === "extract" ? 2 : snapshot.resumeStep === "download" || transferStarted(snapshot) ? 1 : 0;
    default: return 0;
  }
}

const stopped = (snapshot: DownloadProgressSnapshot) => ["error", "interrupted", "cancelled"].includes(snapshot.phase);

/** The five stages with their lines, and which one the download is at. */
export function wizardStages(snapshot: DownloadProgressSnapshot, steam = isSteamDownload(snapshot)): { stages: WizardStage[]; at: number; steam: boolean } {
  const steps = downloadSteps(snapshot, steam);
  const at = stageAt(snapshot, steps);
  const bars = downloadBars(snapshot);
  const finished = snapshot.phase === "completed";
  const stages = STAGE_ORDER.map((id, index): WizardStage => {
    const state: StageState = finished || index < at ? "done" : index > at ? "pending" : stopped(snapshot) ? "failed" : "current";
    const subs: WizardSub[] = steps.filter(step => STAGE_STEPS[id].includes(step.id)).map(step => ({
      key: step.id, title: STEP_TITLE[step.id], text: step.text, ms: step.ms, startedAt: step.startedAt, facts: step.facts,
      // A stage that is behind has nothing pending any more; one that stopped shows where.
      state: state === "done" && (step.state === "pending" || step.state === "current") ? (step.state === "current" ? "done" : "skipped")
        : state === "failed" && step.state === "current" ? "failed" : step.state,
    }));
    if (id === "prepare" && state === "current" && !steam && !subs.some(sub => sub.state === "current")) {
      // No step names what happens now (a torrent looking for its peers, the queue starting the worker).
      subs.push({ key: "connect", title: "dlStepConnect", text: snapshot.statusText ?? "", state: "current" });
    }
    if (id === "download" && typeof snapshot.checkPercent === "number") {
      subs.unshift({ key: "check", title: "dlStepCheck", text: "", state: "current", percent: snapshot.checkPercent });
    }
    if (id === "ready") subs.push({ key: "library", title: "dlStepLibrary", text: "", state: finished ? "done" : "pending" });
    const percent = id === "download" && (state === "current" || state === "failed") && transferStarted(snapshot) ? bars.download
      : id === "install" && !steam && (state === "current" || state === "failed") ? bars.install : undefined;
    return { id, state, subs, percent };
  });
  return { stages, at, steam };
}
