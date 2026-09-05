import { describe, expect, it, vi } from "vitest";

import { AsyncResourceCache, SingleFlightScheduler } from "./asyncResourceCache";

describe("AsyncResourceCache", () => {
  it("deduplicates two consumers and reuses A-B-A within TTL", async () => {
    let now = 1000;
    const cache = new AsyncResourceCache<string, string>({ ttlMs: 600_000, now: () => now });
    const loadA = vi.fn(async () => "A");
    const first = cache.get("local|backend-a|1", loadA);
    const second = cache.get("local|backend-a|1", loadA);
    expect(first).toBe(second);
    await expect(first).resolves.toBe("A");
    await cache.get("local|backend-a|2", async () => "B");
    await expect(cache.get("local|backend-a|1", loadA)).resolves.toBe("A");
    expect(loadA).toHaveBeenCalledTimes(1);
    now += 600_001;
    await cache.get("local|backend-a|1", loadA);
    expect(loadA).toHaveBeenCalledTimes(2);
  });

  it("isolates source/backend keys and retries failures", async () => {
    const cache = new AsyncResourceCache<string, number>({ ttlMs: 1000 });
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary");
      return 7;
    };
    await expect(cache.get("local|a|1", flaky)).rejects.toThrow("temporary");
    await expect(cache.get("local|a|1", flaky)).resolves.toBe(7);
    await expect(cache.get("gameaccess|a|1", async () => 9)).resolves.toBe(9);
    expect(calls).toBe(2);
  });
});

describe("SingleFlightScheduler", () => {
  it("deduplicates same keys and never runs two heavy tasks simultaneously", async () => {
    const scheduler = new SingleFlightScheduler<string, string>();
    let active = 0;
    let maxActive = 0;
    const deferred: Array<() => void> = [];
    const task = (value: string) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => deferred.push(resolve));
      active -= 1;
      return value;
    };
    const a1 = scheduler.request("a", task("a"));
    const a2 = scheduler.request("a", task("duplicate"));
    const b = scheduler.request("b", task("b"));
    expect(a1).toBe(a2);
    expect(scheduler.queuedCount()).toBe(1);
    deferred.shift()?.();
    await expect(a1).resolves.toBe("a");
    await Promise.resolve();
    deferred.shift()?.();
    await expect(b).resolves.toBe("b");
    expect(maxActive).toBe(1);
  });
});
