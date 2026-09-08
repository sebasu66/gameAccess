import { describe, expect, it } from "vitest";

import css from "../public/library-room-layout.css?raw";

describe("desktop library layout contract", () => {
  it("bounds the detail panel while leaving the catalog flexible", () => {
    expect(css).toContain("clamp(420px, 48vw, 980px) minmax(0, 1fr)");
    expect(css).not.toContain(".library-room.is-maximized");
    expect(css).not.toContain("minmax(0, 7fr)");
  });

  it("excludes tablet and display surfaces and protects shrinkable children", () => {
    expect(css).toContain(":not(.surface-tablet):not(.surface-display)");
    expect(css).toContain("min-width: 0");
    expect(css).toContain("min-height: 0");
  });
});
