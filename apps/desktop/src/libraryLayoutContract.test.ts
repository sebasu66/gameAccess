import { describe, expect, it } from "vitest";

import css from "../public/library-room-layout.css?raw";

describe("desktop library layout contract", () => {
  it("keeps the desktop detail and grid columns at a real 50/50 split", () => {
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
    expect(css).not.toContain("440px");
    expect(css).not.toContain("31vw");
  });

  it("excludes tablet and display surfaces and protects shrinkable children", () => {
    expect(css).toContain(":not(.surface-tablet):not(.surface-display)");
    expect(css).toContain("min-width: 0");
  });
});
