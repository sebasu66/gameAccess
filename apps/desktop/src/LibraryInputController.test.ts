import { describe, expect, it } from "vitest";

import { nextCatalogMode, nextGridIndex } from "./LibraryInputController";

describe("persistent library keyboard navigation", () => {
  it("moves through the current grid without entering detail at the left edge", () => {
    expect(nextGridIndex(4, 12, 4, "left")).toBe(4);
    expect(nextGridIndex(5, 12, 4, "left")).toBe(4);
    expect(nextGridIndex(5, 12, 4, "right")).toBe(6);
    expect(nextGridIndex(5, 12, 4, "up")).toBe(1);
    expect(nextGridIndex(5, 12, 4, "down")).toBe(9);
  });

  it("clamps incomplete last rows rather than changing surfaces", () => {
    expect(nextGridIndex(9, 10, 4, "down")).toBe(9);
    expect(nextGridIndex(9, 10, 4, "right")).toBe(9);
  });

  it("cycles catalog tabs exactly once in both directions", () => {
    expect(nextCatalogMode("local")).toBe("gameaccess");
    expect(nextCatalogMode("gameaccess")).toBe("store");
    expect(nextCatalogMode("store")).toBe("local");
    expect(nextCatalogMode("local", true)).toBe("store");
  });
});
