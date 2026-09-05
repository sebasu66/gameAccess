import { describe, expect, it } from "vitest";

import { nextDialogFocusIndex } from "./dialogFocus";

describe("modal keyboard isolation", () => {
  it("cycles focus inside the dialog in both directions", () => {
    expect(nextDialogFocusIndex(0, 3, false)).toBe(1);
    expect(nextDialogFocusIndex(2, 3, false)).toBe(0);
    expect(nextDialogFocusIndex(0, 3, true)).toBe(2);
  });

  it("handles empty dialogs safely", () => {
    expect(nextDialogFocusIndex(0, 0, false)).toBe(-1);
  });
});
