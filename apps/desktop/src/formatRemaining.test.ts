import { describe, expect, it } from "vitest";
import { formatRemaining } from "./activationLifetime";

describe("formatRemaining", () => {
  it("shows minutes under an hour", () => {
    expect(formatRemaining(45 * 60_000)).toBe("45 min");
    expect(formatRemaining(30_000)).toBe("1 min");
  });
  it("shows hours and minutes under a day", () => {
    expect(formatRemaining(11 * 3_600_000 + 32 * 60_000)).toBe("11 h 32 min");
    expect(formatRemaining(2 * 3_600_000 + 5 * 60_000)).toBe("2 h 05 min");
  });
  it("shows days for long accesses", () => {
    expect(formatRemaining(51 * 3_600_000)).toBe("2 d 3 h");
  });
  it("never goes negative", () => {
    expect(formatRemaining(-5)).toBe("0 min");
    expect(formatRemaining(Number.NaN)).toBe("0 min");
  });
});
