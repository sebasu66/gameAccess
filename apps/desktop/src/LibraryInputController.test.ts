import { describe, expect, it } from "vitest";

import { nextCatalogMode } from "./LibraryInputController";

describe("persistent library keyboard navigation", () => {
  it("cycles catalog tabs exactly once in both directions", () => {
    expect(nextCatalogMode("local")).toBe("gameaccess");
    expect(nextCatalogMode("gameaccess")).toBe("local");
    expect(nextCatalogMode("local", true)).toBe("gameaccess");
  });

  it("does not own a second visible library search control", async () => {
    const source = await import("./LibraryInputController?raw").then((module) => String(module.default));
    expect(source).not.toContain('className="library-global-search"');
    expect(source).toContain("Directional keys deliberately bubble to LibraryRoom");
  });
});
