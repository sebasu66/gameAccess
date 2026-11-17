import { describe, expect, it } from "vitest";
import { kidScale } from "./kidScale";

describe("kidScale", () => {
  it("lays the child's screen out as 1920 x 1080 on any monitor and Windows scale", () => {
    expect(kidScale(1920, 1080)).toBe(1);          // 1080p at 100 %
    expect(kidScale(1280, 720)).toBe(0.667);       // 1080p at 150 %
    expect(kidScale(1536, 864)).toBe(0.8);         // 1080p at 125 %
    expect(kidScale(2560, 1440)).toBe(1.333);      // 1440p at 100 %, or 4K at 150 %
    expect(kidScale(3840, 2160)).toBe(2);          // 4K at 100 %
    expect(kidScale(1366, 768)).toBe(0.711);       // a small laptop
  });
  it("follows the shorter side on a wide or tall screen and stays within bounds", () => {
    expect(kidScale(3440, 1440)).toBe(1.333);
    expect(kidScale(400, 300)).toBe(0.5);
    expect(kidScale(0, 0)).toBe(1);
  });
});
