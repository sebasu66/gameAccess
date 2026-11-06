import { beforeEach, describe, expect, it, vi } from "vitest";

let statuses: Array<{ type: string; alive: boolean }> = [];
const polls = vi.fn(async () => undefined);
vi.mock("../catalog/PluginRuntime", () => ({ getPluginStatuses: () => statuses, pollPluginRuntime: () => polls() }));
const check = vi.fn();
vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../catalog/PluginSources", () => ({ checkPluginSources: (games: unknown, report: unknown) => check(games, report) }));

import { activitySnapshot, clearActivity } from "../activity/activity";
import { centralDialog } from "./centralDialog";
import { runPluginSourcesTask } from "./pluginTask";

describe("plugin sources, a task of the Activity panel", () => {
  beforeEach(() => { statuses = []; check.mockReset(); polls.mockClear(); });

  it("without a running sources plugin there is nothing to sync", async () => {
    await runPluginSourcesTask();
    expect(check).not.toHaveBeenCalled();
  });

  it("syncs a running plugin and shows what it saves", async () => {
    statuses = [{ type: "source_provider", alive: true }];
    const seen: unknown[] = [];
    const unsubscribe = centralDialog.subscribe(state => {
      const step = state.task?.steps[0];
      if (step?.total) seen.push([step.done, step.total, step.detail]);
    });
    check.mockImplementation(async (_games: unknown, report: (detail: string, done?: number, total?: number) => void) => { report("Guardando", 120, 300); });
    await runPluginSourcesTask();
    unsubscribe();
    expect(seen).toContainEqual([120, 300, "Guardando"]);
  });

  it("a plugin just installed is waited for while it starts, then synced (no restart)", async () => {
    vi.useFakeTimers();
    polls.mockImplementation(async () => { if (polls.mock.calls.length >= 3) statuses = [{ type: "source_provider", alive: true }]; });
    const task = runPluginSourcesTask({ waitForPlugin: true });
    await vi.advanceTimersByTimeAsync(5000);
    await task;
    vi.useRealTimers();
    expect(polls.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(check).toHaveBeenCalledOnce();
  });

  it("runs in the Activity panel, never as the central dialog", async () => {
    statuses = [{ type: "source_provider", alive: true }];
    const states: Array<{ visible: boolean; background?: boolean }> = [];
    const unsubscribe = centralDialog.subscribe(state => { if (state.task) states.push({ visible: state.taskVisible, background: state.task.background }); });
    check.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 700)); });
    await runPluginSourcesTask();
    unsubscribe();
    expect(states.length).toBeGreaterThan(0);
    expect(states.every(state => state.background && !state.visible)).toBe(true);
    expect(activitySnapshot()[0]).toMatchObject({ kind: "task", state: "done" });
  });

  it("a failed sync goes to the history without stopping the app; the same failure again only goes to the log", async () => {
    clearActivity();
    statuses = [{ type: "source_provider", alive: true }];
    check.mockRejectedValue(new Error("Esta versión es vieja"));
    await runPluginSourcesTask();
    expect(centralDialog.snapshot()).toMatchObject({ task: null, taskVisible: false });
    expect(activitySnapshot()[0]).toMatchObject({ kind: "task", state: "failed" });
    expect(activitySnapshot()[0].text).toContain("Esta versión es vieja");

    await runPluginSourcesTask(); // same failure again: not listed twice
    expect(activitySnapshot().filter(entry => entry.state === "failed")).toHaveLength(1);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
