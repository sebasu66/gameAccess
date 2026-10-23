import { describe, expect, it, vi } from "vitest";
import { runUpdate, updatesEnabled, type AvailableUpdate, type DownloadEvent, type UpdatePhase } from "./appUpdate";

function deps(update: AvailableUpdate | null | Error) {
  return {
    check: vi.fn(() => (update instanceof Error ? Promise.reject(update) : Promise.resolve(update))),
    relaunch: vi.fn(() => Promise.resolve()),
    log: vi.fn(),
  };
}

function fakeUpdate(events: DownloadEvent[], fail?: Error): AvailableUpdate {
  return {
    version: "0.2.0",
    async downloadAndInstall(onEvent) {
      for (const event of events) onEvent(event);
      if (fail) throw fail;
    },
  };
}

describe("app self-update", () => {
  it("only release builds inside the desktop app look for updates", () => {
    expect(updatesEnabled("release", true)).toBe(true);
    expect(updatesEnabled(undefined, true)).toBe(false);
    expect(updatesEnabled("dev", true)).toBe(false);
    expect(updatesEnabled("release", false)).toBe(false);
  });

  it("lets the app go on when there is no update or the check fails", async () => {
    for (const result of [null, new Error("offline")]) {
      const phases: UpdatePhase[] = [];
      const d = deps(result);
      await runUpdate(d, (phase) => phases.push(phase));
      expect(phases).toEqual([{ kind: "idle" }]);
      expect(d.relaunch).not.toHaveBeenCalled();
    }
  });

  it("downloads with progress, installs and restarts", async () => {
    const phases: UpdatePhase[] = [];
    const d = deps(fakeUpdate([
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 40 } },
      { event: "Progress", data: { chunkLength: 60 } },
      { event: "Finished" },
    ]));
    await runUpdate(d, (phase) => phases.push(phase));
    expect(phases).toContainEqual({ kind: "downloading", version: "0.2.0", done: 40, total: 100 });
    expect(phases).toContainEqual({ kind: "downloading", version: "0.2.0", done: 100, total: 100 });
    expect(phases.at(-1)).toEqual({ kind: "installing", version: "0.2.0" });
    expect(d.relaunch).toHaveBeenCalledOnce();
  });

  it("tells the player a new version was found and waits for them before downloading", async () => {
    const order: string[] = [];
    let close!: () => void;
    const d = { ...deps({ version: "0.2.0", async downloadAndInstall() { order.push("download"); } }),
      announce: vi.fn((version: string) => { order.push(`announce ${version}`); return new Promise<void>(resolve => { close = resolve; }); }) };
    const done = runUpdate(d, () => undefined);
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(["announce 0.2.0"]);
    close();
    await done;
    expect(order).toEqual(["announce 0.2.0", "download"]);
  });

  it("reports a failed install instead of restarting", async () => {
    const phases: UpdatePhase[] = [];
    const d = deps(fakeUpdate([{ event: "Started", data: { contentLength: 10 } }], new Error("signature mismatch")));
    await runUpdate(d, (phase) => phases.push(phase));
    expect(phases.at(-1)).toEqual({ kind: "failed", version: "0.2.0", error: "signature mismatch" });
    expect(d.relaunch).not.toHaveBeenCalled();
  });
});
