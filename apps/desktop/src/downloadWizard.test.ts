import { describe, expect, it } from "vitest";
import { stageFacts, stageOfStep, wizardStages } from "./downloadWizard";
import { appendEvents, downloadEvents, factLines, MAX_EVENTS } from "./downloadEvents";
import type { DownloadProgressSnapshot } from "./downloadProvider";

const states = (snapshot: DownloadProgressSnapshot) => wizardStages(snapshot).stages.map(stage => `${stage.id}:${stage.state}`);

describe("download wizard stages (RN9)", () => {
  it("groups the launcher's steps into five stages", () => {
    expect(["pick", "route", "probe", "server"].map(id => stageOfStep(id as never))).toEqual(["prepare", "prepare", "prepare", "prepare"]);
    expect([stageOfStep("download"), stageOfStep("extract"), stageOfStep("install")]).toEqual(["download", "install", "configure"]);
  });

  it("follows the running step", () => {
    const snapshot: DownloadProgressSnapshot = { gameId: 1, phase: "downloading", progress: 40, downloadPercent: 40, bytesDownloaded: 400,
      step: { id: "download", detail: "", startedAt: 1 }, steps: [{ id: "route", state: "done", result: "", ms: 10 }] };
    const { stages, at } = wizardStages(snapshot);
    expect(at).toBe(1);
    expect(states(snapshot)).toEqual(["prepare:done", "download:current", "install:pending", "configure:pending", "ready:pending"]);
    expect(stages[1].percent).toBe(40);
  });

  it("marks where a download stopped as failed", () => {
    const snapshot: DownloadProgressSnapshot = { gameId: 1, phase: "error", progress: 70, error: "Disco lleno", resumeStep: "extract",
      step: { id: "extract", detail: "", startedAt: 1 }, steps: [] };
    expect(states(snapshot)).toEqual(["prepare:done", "download:done", "install:failed", "configure:pending", "ready:pending"]);
  });

  it("shows the setup as its own stage and a finished download as ready", () => {
    expect(wizardStages({ gameId: 1, phase: "installing", progress: 99 }).at).toBe(3);
    const done = wizardStages({ gameId: 1, phase: "completed", progress: 100 });
    expect(done.stages.every(stage => stage.state === "done")).toBe(true);
    expect(done.stages[4].subs).toEqual([expect.objectContaining({ key: "library", state: "done" })]);
  });

  it("says what preparing does when no step names it", () => {
    const { stages } = wizardStages({ gameId: 1, phase: "preparing", progress: 0, statusText: "Buscando pares" });
    expect(stages[0].subs.at(-1)).toMatchObject({ key: "connect", state: "current", text: "Buscando pares" });
  });
});

describe("download log", () => {
  it("writes a line when something changes, not for each tick", () => {
    const queued: DownloadProgressSnapshot = { gameId: 1, phase: "queued", progress: 0 };
    expect(downloadEvents(undefined, queued, 5)).toEqual([expect.objectContaining({ at: 5, level: "INF", stage: "prepare" })]);
    const running: DownloadProgressSnapshot = { gameId: 1, phase: "downloading", progress: 10, step: { id: "download", detail: "", startedAt: 1 } };
    const later = { ...running, progress: 20 };
    expect(downloadEvents(running, later)).toEqual([]);
    const failed: DownloadProgressSnapshot = { ...later, phase: "error", error: "Sin semillas" };
    expect(downloadEvents(later, failed)).toEqual([expect.objectContaining({ level: "ERR", stage: "download", text: "Sin semillas" })]);
  });

  it("notes a torrent that leaves the race", () => {
    const lane = { title: "Repack", provider: "x", done: 0, total: 100, speed: 0, seeds: 1, state: "racing" as const };
    const before: DownloadProgressSnapshot = { gameId: 1, phase: "preparing", progress: 0, race: [lane] };
    const after: DownloadProgressSnapshot = { ...before, race: [{ ...lane, state: "out" }] };
    expect(downloadEvents(before, after).map(event => event.level)).toEqual(["WRN"]);
  });

  it("keeps the same log when nothing was added and at most MAX_EVENTS lines", () => {
    const snapshot: DownloadProgressSnapshot = { gameId: 1, phase: "downloading", progress: 1 };
    const log = [{ at: 1, level: "INF" as const, stage: "download" as const, text: "a" }];
    expect(appendEvents(log, snapshot, snapshot)).toBe(log);
    const full = Array.from({ length: MAX_EVENTS }, (_, at) => ({ at, level: "INF" as const, stage: "download" as const, text: "a" }));
    expect(appendEvents(full, snapshot, { ...snapshot, phase: "paused" })).toHaveLength(MAX_EVENTS);
  });
});

describe("speed chart", () => {
  it("scales the last minute to its peak and needs two samples to draw", async () => {
    const { speedPath } = await import("./navigation/DownloadWizard");
    expect(speedPath([{ time: 1000, speedBps: 5 }])).toMatchObject({ line: "", peak: 5 });
    const { line, area, peak } = speedPath([{ time: 0, speedBps: 10 }, { time: 60_000, speedBps: 20 }]);
    expect(peak).toBe(20);
    expect(line).toBe("M0.0,51.0 L600.0,10.0");
    expect(area.endsWith("L600.0,100 L0.0,100 Z")).toBe(true);
  });
});

describe("a free Steam game's stages", () => {
  it("has only its own steps: no source, route or unpacking", () => {
    const { stages, steam } = wizardStages({ gameId: 570, phase: "downloading", progress: 40,
      steps: [{ id: "signin", state: "done", result: "Signed in", ms: 1, facts: { account: "player" } }],
      step: { id: "download", detail: "client.dll", startedAt: 1, facts: { folder: "F:/SteamLibrary/steamapps/common/dota 2 beta", drive: "F:" } } });
    expect(steam).toBe(true);
    expect(stages.flatMap(stage => stage.subs.map(sub => sub.key))).toEqual(["signin", "download", "handoff", "adopt", "library"]);
    expect(stageFacts(stages[1])).toEqual({ folder: "F:/SteamLibrary/steamapps/common/dota 2 beta", drive: "F:" });
  });

  it("Steam installing it: its install window, then Steam's download", () => {
    const { stages, steam } = wizardStages({ gameId: 570, phase: "downloading", progress: 40,
      steps: [{ id: "dialog", state: "done", result: "Steam started the install", ms: 1 }],
      step: { id: "download", detail: "Steam is downloading it", startedAt: 1 } });
    expect(steam).toBe(true);
    expect(stages.flatMap(stage => stage.subs.map(sub => sub.key))).toEqual(["dialog", "download", "library"]);
  });

  it("a stopped unpacking keeps which folder and disk ran short", () => {
    const { stages, at } = wizardStages({ gameId: 1, phase: "error", progress: 50, error: "no room", resumeStep: "extract", step: null,
      steps: [{ id: "download", state: "done", result: "", ms: 1 },
        { id: "extract", state: "failed", result: "no room", ms: 1, facts: { folder: "D:/Games/X", drive: "D:", freeBytes: 1, neededBytes: 9 } }] });
    expect(stages[at].id).toBe("install");
    expect(stages[at].state).toBe("failed");
    expect(stageFacts(stages[at])).toMatchObject({ drive: "D:", folder: "D:/Games/X" });
  });
});

describe("a step's specifics go to the log", () => {
  it("writes which file, which folder and disk, and the space that ran short, once", () => {
    const failed: DownloadProgressSnapshot = { gameId: 1, phase: "error", progress: 50, error: "no room", step: null,
      steps: [{ id: "extract", state: "failed", result: "no room", ms: 1, facts: { from: "game.part01.rar", folder: "D:/Games/X", drive: "D:", freeBytes: 1e9, neededBytes: 9e9 } }] };
    const lines = downloadEvents(undefined, failed, 5).filter(event => event.stage === "install");
    expect(lines.map(line => line.level)).toEqual(["INF", "INF", "ERR", "ERR"]);
    expect(lines[1].text).toContain("D:/Games/X");
    expect(lines[2].text).toContain("D:");
    expect(factLines(failed.steps![0].facts, failed.steps![0].facts)).toEqual([]);
  });
});
