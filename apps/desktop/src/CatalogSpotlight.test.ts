import { describe, expect, it } from "vitest";
import { daysSinceRelease } from "./CatalogSpotlight";

describe("catalog spotlight", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  it("counts whole days since a game came out", () => {
    expect(daysSinceRelease("2026-10-24", now)).toBe(0);
    expect(daysSinceRelease("2026-10-21", now)).toBe(3);
  });
  it("has no age for unknown or future dates", () => {
    expect(daysSinceRelease(null, now)).toBeNull();
    expect(daysSinceRelease("soon", now)).toBeNull();
    expect(daysSinceRelease("2026-12-01", now)).toBeNull();
  });
});
