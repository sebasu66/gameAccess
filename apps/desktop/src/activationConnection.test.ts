import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForActivationConnection } from "./activationConnection";
import type { BackendConnection } from "./settings";

afterEach(() => vi.useRealTimers());
describe("activation server wake-up", () => {
  it("keeps trying past 75 seconds and resumes automatically", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let attempts = 0;
    const waiting = vi.fn();
    const probe = async (): Promise<BackendConnection> => ++attempts <= 30
      ? { kind: "offline", url: "" }
      : { kind: "remote", url: "https://example.com" };
    const result = waitForActivationConnection(controller.signal, waiting, probe);
    await vi.advanceTimersByTimeAsync(90000);
    expect(await result).toEqual({ kind: "remote", url: "https://example.com" });
    expect(waiting).toHaveBeenCalledTimes(30);
  });
  it("stops retries when the screen is replaced or a new retry starts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const probe = vi.fn(async (): Promise<BackendConnection> => ({ kind: "offline", url: "" }));
    const result = waitForActivationConnection(controller.signal, vi.fn(), probe);
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(60000);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
