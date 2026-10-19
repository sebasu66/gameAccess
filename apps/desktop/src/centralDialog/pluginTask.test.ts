import { beforeEach, describe, expect, it, vi } from "vitest";

let statuses: Array<{ type: string; alive: boolean }> = [];
const polls = vi.fn(async () => undefined);
vi.mock("../catalog/PluginRuntime", () => ({ getPluginStatuses: () => statuses, pollPluginRuntime: () => polls() }));
const check = vi.fn();
vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../catalog/PluginSources", () => ({ checkPluginSources: (games: unknown, report: unknown) => check(games, report) }));

import { centralDialog } from "./centralDialog";
import { runPluginSourcesTask } from "./pluginTask";

describe("plugin sources in the central dialog", () => {
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

  it("a failed sync is shown with retry; the same failure in a later automatic sync only goes to the log", async () => {
    statuses = [{ type: "source_provider", alive: true }];
    check.mockRejectedValue(new Error("Esta versión es vieja"));
    const first = runPluginSourcesTask();
    await vi.waitFor(() => expect(centralDialog.snapshot().task?.failure).toContain("Esta versión es vieja"));
    expect(centralDialog.snapshot().task?.canRetry).toBe(true);

    check.mockResolvedValueOnce({}); // the player updated the plugin and retries
    centralDialog.answerFailure("retry");
    await first;
    expect(check).toHaveBeenCalledTimes(2);

    check.mockRejectedValue(new Error("Otra falla"));
    const second = runPluginSourcesTask();
    await vi.waitFor(() => expect(centralDialog.snapshot().task?.failure).toContain("Otra falla"));
    centralDialog.answerFailure("continue");
    await second;
    await runPluginSourcesTask(); // same failure again: not shown twice
    expect(centralDialog.snapshot().task).toBeNull();
    expect(check).toHaveBeenCalledTimes(4);
  });
});
