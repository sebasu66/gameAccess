import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  debugLoggingEnabled,
  debugTrace,
  flushDebugLog,
  resetDebugLoggingForTests,
  setDebugLogging,
  subscribeDebugLogging,
  toggleDebugLogging,
} from "./debugLog";

const narrateBatch = vi.fn().mockResolvedValue(undefined);
const narrate = vi.fn().mockResolvedValue(undefined);
vi.mock("./narrationLog", () => ({
  narrate: (...args: unknown[]) => narrate(...args),
  narrateBatch: (...args: unknown[]) => narrateBatch(...args),
}));

describe("flag-gated diagnostic logging", () => {
  beforeEach(() => {
    resetDebugLoggingForTests();
    narrate.mockClear();
    narrateBatch.mockClear();
  });

  afterEach(() => {
    resetDebugLoggingForTests();
    vi.unstubAllGlobals();
  });

  it("stays silent while the flag is off", () => {
    expect(debugLoggingEnabled()).toBe(false);
    debugTrace("COVERS", "probe app_id=42");
    flushDebugLog();
    expect(narrateBatch).not.toHaveBeenCalled();
    expect(narrate).not.toHaveBeenCalled();
  });

  it("buffers trace lines and flushes them as one batch, not one write per line", () => {
    setDebugLogging(true);
    for (let i = 0; i < 25; i++) debugTrace("COVERS", `probe ${i}`);
    flushDebugLog();

    // A burst of traces must become a single IPC write; one write per image
    // would flood both the activity log and the disk.
    expect(narrateBatch).toHaveBeenCalledTimes(1);
    const [lines] = narrateBatch.mock.calls[0] as [string[]];
    expect(lines).toHaveLength(25);
    expect(lines[0]).toContain("[DEBUG COVERS]");
    expect(lines[24]).toContain("probe 24");
  });

  it("reports the state change even when turning diagnostics off", () => {
    setDebugLogging(true);
    narrate.mockClear();
    setDebugLogging(false);
    expect(narrate).toHaveBeenCalledTimes(1);
    const [message, options] = narrate.mock.calls[0] as [string, { area?: string }];
    expect(message).toContain("desactivado");
    expect(options.area).toBe("DEBUG");
  });

  it("toggles and notifies subscribers", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeDebugLogging(enabled => seen.push(enabled));

    expect(toggleDebugLogging()).toBe(true);
    expect(debugLoggingEnabled()).toBe(true);
    expect(toggleDebugLogging()).toBe(false);
    expect(debugLoggingEnabled()).toBe(false);
    expect(seen).toEqual([true, false]);

    unsubscribe();
    setDebugLogging(true);
    expect(seen).toEqual([true, false]);
  });

  it("drops excess trace lines instead of growing without bound", () => {
    setDebugLogging(true);
    for (let i = 0; i < 260; i++) debugTrace("COVERS", `line ${i}`);
    flushDebugLog();
    const [lines] = narrateBatch.mock.calls[0] as [string[]];
    // The buffer is capped, and the drop is reported rather than hidden.
    expect(lines.length).toBeLessThanOrEqual(201);
    expect(lines.some(line => line.includes("descartada"))).toBe(true);
  });
});
