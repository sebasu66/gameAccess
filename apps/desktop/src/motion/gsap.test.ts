import { afterEach, describe, expect, it, vi } from "vitest";
import { dur, motionOk } from "./gsap";

const setReduce = (matches: boolean) => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") && matches, addEventListener() {}, removeEventListener() {} }));
};

describe("motion helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("allows motion unless the system asks to reduce it", () => {
    setReduce(false);
    expect(motionOk()).toBe(true);
    expect(dur(.6)).toBe(.6);
  });

  it("jumps tweens to their end when motion is reduced", () => {
    setReduce(true);
    expect(motionOk()).toBe(false);
    expect(dur(.6)).toBe(0);
  });
});
