import { describe, expect, it } from "vitest";
import { RELEASE_LAST_INDEX, RELEASE_STEPS, releaseIndexFor, releaseShort, releaseWords } from "./releaseScale";

describe("release scale", () => {
  it("goes from any date in the past to the last month, getting finer near the present", () => {
    expect(RELEASE_STEPS[0]).toBeUndefined();
    expect(RELEASE_STEPS[RELEASE_LAST_INDEX]).toBe(30);
    expect(RELEASE_STEPS[1]).toBe(30 * 365);
    for (let i = 2; i <= RELEASE_LAST_INDEX; i++) expect(RELEASE_STEPS[i] as number).toBeLessThan(RELEASE_STEPS[i - 1] as number || Infinity);
  });
  it("finds the step for a number of days", () => {
    expect(releaseIndexFor(undefined)).toBe(0);
    expect(RELEASE_STEPS[releaseIndexFor(365)]).toBe(365);
    expect(RELEASE_STEPS[releaseIndexFor(90)]).toBe(90);
  });
  it("words", () => {
    expect(releaseWords(undefined)).toBeNull();
    expect(releaseWords(60)).toBe("en los últimos 2 meses");
    expect(releaseShort(730)).toBe("2 años");
    expect(releaseShort(undefined)).toBe("cualquiera");
  });
});
