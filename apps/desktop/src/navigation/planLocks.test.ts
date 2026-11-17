import { describe, expect, it } from "vitest";
import { NAVIGATION } from "./navigationTree";
import { PLUS_SECTIONS, PLUS_TABS, planLocked } from "./planLocks";

describe("lo que BASE no incluye (§5.12)", () => {
  it("cada sección y submodo de PLUS existe en el árbol", () => {
    const sections: { id: string; tabs: readonly { id: string }[] }[] = NAVIGATION.flatMap(mode => [...mode.sections]);
    for (const id of PLUS_SECTIONS) expect(sections.some(section => section.id === id)).toBe(true);
    for (const [section, tabs] of Object.entries(PLUS_TABS))
      for (const tab of tabs) expect(sections.find(item => item.id === section)?.tabs.some(item => item.id === tab)).toBe(true);
  });

  it("con BASE llevan candado; con PLUS no; lo demás nunca", () => {
    expect(planLocked(false, "aiSuggestions")).toBe(true);
    expect(planLocked(false, "general", "mcp")).toBe(true);
    expect(planLocked(true, "aiSuggestions")).toBe(false);
    expect(planLocked(true, "general", "mcp")).toBe(false);
    expect(planLocked(false, "explore")).toBe(false);
    expect(planLocked(false, "general", "steam")).toBe(false);
  });
});
