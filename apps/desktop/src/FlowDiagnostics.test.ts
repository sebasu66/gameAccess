import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./narrationLog", () => ({ narrate: vi.fn(), narrateBatch: vi.fn() }));
import { narrate, narrateBatch } from "./narrationLog";
import { FlowDiagnostics } from "./FlowDiagnostics";

describe("transaction diagnostics", () => {
  beforeEach(() => vi.clearAllMocks());
  it("keeps all detail in memory and discards success without file writes", () => {
    const flow = new FlowDiagnostics("download", "DOWNLOAD");
    for (let n = 0; n < 10000; n++) flow.debug(`step=${n}`);
    expect(flow.pendingCount).toBe(10000);
    expect(narrateBatch).not.toHaveBeenCalled();
    flow.succeed();
    expect(flow.pendingCount).toBe(0);
    flow.fail("late callback");
    expect(narrate).not.toHaveBeenCalled();
  });
  it("flushes only the failed operation, once, without provider credentials", () => {
    const good = new FlowDiagnostics("source", "DOWNLOAD_SOURCES");
    const bad = new FlowDiagnostics("source", "DOWNLOAD_SOURCES");
    good.debug("successful detail");
    bad.debug("https://host/private?token=hidden password=secret");
    good.succeed();
    bad.fail("provider unavailable");
    bad.fail("duplicate");
    expect(narrateBatch).toHaveBeenCalledTimes(1);
    expect(narrate).toHaveBeenCalledTimes(1);
    const output = JSON.stringify(vi.mocked(narrateBatch).mock.calls);
    expect(output).not.toMatch(/hidden|secret|successful detail/);
    expect(bad.pendingCount).toBe(0);
  });
});
