import { describe, expect, it } from "vitest";

import { isCurrentSelectedDetail, shouldLoadSelectedDetails } from "./useSelectedGameDetails";

describe("selected game detail loading contract", () => {
  it("loads the initially displayed desktop game without requiring a second click", () => {
    expect(shouldLoadSelectedDetails({
      surface: "desktop",
      selectedGameId: 42,
      detailRequestedGameId: null,
      tabletDetailsOpen: false,
    })).toBe(true);
  });

  it("preserves explicit tablet detail opening", () => {
    expect(shouldLoadSelectedDetails({
      surface: "tablet",
      selectedGameId: 42,
      detailRequestedGameId: 42,
      tabletDetailsOpen: false,
    })).toBe(false);
    expect(shouldLoadSelectedDetails({
      surface: "tablet",
      selectedGameId: 42,
      detailRequestedGameId: 42,
      tabletDetailsOpen: true,
    })).toBe(true);
  });

  it("preserves display IPC request gating", () => {
    expect(shouldLoadSelectedDetails({
      surface: "display",
      selectedGameId: 42,
      detailRequestedGameId: null,
      tabletDetailsOpen: false,
    })).toBe(false);
    expect(shouldLoadSelectedDetails({
      surface: "display",
      selectedGameId: 42,
      detailRequestedGameId: 42,
      tabletDetailsOpen: false,
    })).toBe(true);
  });

  it("rejects stale selection identities", () => {
    expect(isCurrentSelectedDetail(41, 42)).toBe(false);
    expect(isCurrentSelectedDetail(42, 42)).toBe(true);
  });
});
