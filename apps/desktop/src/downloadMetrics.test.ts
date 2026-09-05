import { describe, expect, it } from "vitest";

import { calculateEtaSeconds, observedTransferRate } from "./downloadMetrics";

describe("download metrics", () => {
  it("computes ETA only from real remaining transfer bytes and observed speed", () => {
    expect(calculateEtaSeconds(1_000, 2_000, 100)).toBe(10);
    expect(calculateEtaSeconds(2_000, 2_000, 100)).toBe(0);
    expect(calculateEtaSeconds(1_000, 2_000, 0)).toBeNull();
    expect(calculateEtaSeconds(null, 2_000, 100)).toBeNull();
    expect(calculateEtaSeconds(1_000, Number.NaN, 100)).toBeNull();
    expect(calculateEtaSeconds(-1, 2_000, 100)).toBeNull();
  });

  it("uses only a bounded 15-second observation window", () => {
    const now = 30_000;
    const rate = observedTransferRate([
      { atMs: 5_000, bytes: 0 },
      { atMs: 15_000, bytes: 1_000 },
      { atMs: 30_000, bytes: 4_000 },
    ], now);
    expect(rate).toBeCloseTo(200, 5);
  });

  it("rejects reset/decreasing counters instead of fabricating negative speed", () => {
    expect(observedTransferRate([
      { atMs: 10_000, bytes: 10_000 },
      { atMs: 20_000, bytes: 1_000 },
    ], 20_000)).toBeNull();
  });
});
