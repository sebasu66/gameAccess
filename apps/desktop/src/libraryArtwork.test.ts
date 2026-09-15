import { describe, expect, it } from "vitest";
import { isPortraitArtwork, libraryArtworkCandidates } from "./libraryArtwork";
import type { CatalogGame } from "./types";

const game = { id: 1, slug: "test", name: "Test", app_id: 242050, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, capsule_image: "https://example.test/cover.jpg", hero_image: "https://example.test/hero.jpg", header_image: "https://example.test/header.jpg" } as CatalogGame;

describe("Steam portrait artwork", () => {
  it("prefers library covers and never adds landscape hero/header fallbacks", () => {
    const sources = libraryArtworkCandidates(game);
    expect(sources[0]).toContain("library_600x900_2x.jpg");
    expect(sources).not.toContain(game.hero_image);
    expect(sources).not.toContain(game.header_image);
    expect(sources.some(source => source.includes("616x353"))).toBe(false);
  });
  it("rejects landscape or square images even when mislabeled as a capsule", () => {
    expect(isPortraitArtwork(600, 900)).toBe(true);
    expect(isPortraitArtwork(1200, 1800)).toBe(true);
    expect(isPortraitArtwork(616, 353)).toBe(false);
    expect(isPortraitArtwork(460, 215)).toBe(false);
    expect(isPortraitArtwork(600, 600)).toBe(false);
    expect(isPortraitArtwork(0, 0)).toBe(false);
  });
});
