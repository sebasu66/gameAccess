// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { defineModeRail } from "./gaModeRail";

describe("ga-mode-rail", () => {
  it("makes one change of a label and a mode set together", async () => {
    defineModeRail();
    const rail = document.createElement("ga-mode-rail") as HTMLElement & { settled(): Promise<void> };
    rail.setAttribute("mode", "home"); rail.setAttribute("label", "HOME");
    document.body.append(rail);
    await rail.settled();
    let starts = 0;
    rail.addEventListener("ga-mode-start", () => { starts += 1; });
    rail.setAttribute("label", "JUEGOS"); rail.setAttribute("mode", "games");
    await rail.settled();
    expect(starts).toBe(1);
    expect(rail.shadowRoot!.querySelectorAll(".word")).toHaveLength(1);
    rail.remove();
  });
});
