import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { regressions, scanCss } from "../scripts/check-dialog-css.mjs";

describe("dialog text template (docs/GUI_DESIGN.md §4.25)", () => {
  it("no stylesheet adds paragraph basics or raw colours past the baseline", () => {
    expect(regressions().map(({ file, issues }: { file: string; issues: unknown[] }) => `${file}: ${issues.length}`)).toEqual([]);
  });

  it("flags a dialog's own paragraph margins and sizes, and raw colours outside the theme", () => {
    const issues = scanCss(".x p { margin: 0; color: var(--ga-muted); }\n.y > :where(p) { font-size: 11px; }\n.z { border: 1px solid #fff; }", "x.css");
    expect(issues.map(([line]: [number]) => line)).toEqual([1, 2, 3]);
    expect(scanCss(".z { border: 1px solid #fff; }", "gameaccess-theme.css")).toEqual([]);
    expect(scanCss(".x .note { margin: 0; color: var(--ga-muted); }", "x.css")).toEqual([]);
  });
});
