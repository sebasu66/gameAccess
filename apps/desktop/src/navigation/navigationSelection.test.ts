import { describe, expect, it } from "vitest";
import { getNavigationSelection, selectNavigationSection } from "./navigationSelection";

describe("selección del nuevo panel", () => {
  it("acepta secciones reales y rechaza destinos ajenos al modo", () => {
    expect(selectNavigationSection("gameAccess", "account")).toBe(true);
    expect(getNavigationSelection().gameAccess).toBe("account");
    expect(selectNavigationSection("gameAccess", "downloads")).toBe(false);
    expect(getNavigationSelection().gameAccess).toBe("account");
    selectNavigationSection("gameAccess", "news");
  });
});
