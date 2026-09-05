import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = fileURLToPath(new URL("../public/library-room-layout.css", import.meta.url));
const css = readFileSync(cssPath, "utf-8");

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
