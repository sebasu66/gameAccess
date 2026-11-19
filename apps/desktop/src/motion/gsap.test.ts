import { afterEach, describe, expect, it, vi } from "vitest";
import { dur, motionOk } from "./gsap";

const setReduce = (matches: boolean) => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") && matches, addEventListener() {}, removeEventListener() {} }));
};

describe("motion helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("allows motion with normal system settings", () => {
    setReduce(false);
    expect(motionOk()).toBe(true);
    expect(dur(.6)).toBe(.6);
  });

  it("keeps animations and their duration when Windows requests reduced motion", () => {
    setReduce(true);
    expect(motionOk()).toBe(true);
    expect(dur(.6)).toBe(.6);
  });
});
