import { describe, expect, it } from "vitest";
import { RELEASE_LAST_INDEX, RELEASE_POSITIONS, RELEASE_STEPS, RELEASE_TRACK, releaseIndexAt, releaseIndexFor, releaseShort, releaseWords } from "./releaseScale";

describe("release scale", () => {
  it("goes from any date in the past to the last month, getting finer near the present", () => {
    expect(RELEASE_STEPS[0]).toBeUndefined();
    expect(RELEASE_STEPS[RELEASE_LAST_INDEX]).toBe(30);
    expect(RELEASE_STEPS[1]).toBe(15 * 365);
    for (let i = 2; i <= RELEASE_LAST_INDEX; i++) expect(RELEASE_STEPS[i] as number).toBeLessThan(RELEASE_STEPS[i - 1] as number || Infinity);
  });
  it("finds the step for a number of days", () => {
    expect(releaseIndexFor(undefined)).toBe(0);
    expect(RELEASE_STEPS[releaseIndexFor(365)]).toBe(365);
    expect(RELEASE_STEPS[releaseIndexFor(90)]).toBe(90);
  });
  it("gives the last 12 months 30 % of the slider", () => {
    const oneYear = RELEASE_POSITIONS[releaseIndexFor(365)];
    expect(oneYear).toBe(RELEASE_TRACK * 0.7);
    expect(RELEASE_POSITIONS[RELEASE_LAST_INDEX]).toBe(RELEASE_TRACK);
    expect(releaseIndexAt(RELEASE_TRACK)).toBe(RELEASE_LAST_INDEX);
  });
  it("words", () => {
    expect(releaseWords(undefined)).toBeNull();
    expect(releaseWords(60, "es")).toBe("en los últimos 2 meses");
    expect(releaseShort(730, "es")).toBe("2 años");
    expect(releaseShort(undefined, "es")).toBe("cualquiera");
  });
});

describe("release scale in English", () => {
  it("words", () => {
    expect(releaseWords(60, "en")).toBe("in the last 2 months");
    expect(releaseWords(365, "en")).toBe("in the last year");
    expect(releaseShort(730, "en")).toBe("2 years");
    expect(releaseShort(30, "en")).toBe("1 month");
    expect(releaseShort(undefined, "en")).toBe("any");
  });
});
