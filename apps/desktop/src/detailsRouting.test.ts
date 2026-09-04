import { describe, expect, it } from "vitest";
import { findLocalGameForDetails } from "./api";
import type { CatalogGame } from "./types";

const local = { id: 425720, app_id: 425720, slug: "steam-425720", name: "Cloudlands : VR Minigolf", credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 } as CatalogGame;

describe("local Steam details routing", () => {
  it("resolves a local Steam AppID before any remote catalog lookup", () => {
    expect(findLocalGameForDetails(425720, [local])).toBe(local);
  });
  it("does not invent a local match for an unrelated backend id", () => {
    expect(findLocalGameForDetails(999999, [local])).toBeUndefined();
  });
});
