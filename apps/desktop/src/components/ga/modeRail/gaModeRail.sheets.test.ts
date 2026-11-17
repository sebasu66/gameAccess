// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/** The app's content security policy blocks run-time <style> elements: with constructed sheets there must be none. */
class FakeSheet { text = ""; replaceSync(text: string) { this.text = text; } }

describe("ga-mode-rail styles", () => {
  it("uses constructed sheets, not <style> elements, and puts the user's CSS in its own", async () => {
    vi.stubGlobal("CSSStyleSheet", FakeSheet);
    Object.defineProperty(Document.prototype, "adoptedStyleSheets", { value: [], configurable: true });
    const { defineModeRail } = await import("./gaModeRail");
    defineModeRail();
    const rail = document.createElement("ga-mode-rail");
    rail.setAttribute("css", ":host { --rail: red; }");
    document.body.append(rail);
    const root = rail.shadowRoot as ShadowRoot & { adoptedStyleSheets: FakeSheet[] };
    expect(root.querySelector("style")).toBeNull();
    expect(root.adoptedStyleSheets).toHaveLength(2);
    expect(root.adoptedStyleSheets[0].text).toContain(":host");
    expect(root.adoptedStyleSheets[1].text).toBe(":host { --rail: red; }");
    rail.remove();
  });
});
