import { describe, expect, it } from "vitest";

import { isCurrentSelectedDetail } from "./useSelectedGameDetails";

describe("selected game detail loading contract", () => {
  it("rejects stale selection identities", () => {
    expect(isCurrentSelectedDetail(41, 42)).toBe(false);
    expect(isCurrentSelectedDetail(42, 42)).toBe(true);
  });
});
