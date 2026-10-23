import { describe, expect, it } from "vitest";
import { isPortraitArtwork, libraryArtworkCandidates } from "./libraryArtwork";
import { coverTierFor } from "./coverSize";
import type { CatalogGame } from "./types";

const game = { id: 1, slug: "test", name: "Test", app_id: 242050, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, capsule_image: "https://example.test/cover.jpg", hero_image: "https://example.test/hero.jpg", header_image: "https://example.test/header.jpg" } as CatalogGame;

describe("Steam portrait artwork", () => {
  it("never offers landscape hero/header images as grid covers", () => {
    const portrait = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/242050/abc/library_capsule_2x.jpg";
    const sources = libraryArtworkCandidates({ ...game, capsule_image: portrait });
    expect(sources).toEqual([portrait]);
    expect(sources).not.toContain(game.hero_image);
    expect(sources).not.toContain(game.header_image);
    // A derived Steam path would answer 404; it must never be invented here.
    expect(sources.some(source => source.includes("library_600x900"))).toBe(false);
  });

  it("ignores a catalog capsule that is not a library (portrait) capsule", () => {
    // Steam's capsule_imagev5 is a 184x69 banner; an empty list makes the card ask the resolver instead.
    expect(libraryArtworkCandidates({ ...game, capsule_image: "https://example.test/capsule_184x69.jpg" })).toEqual([]);
    expect(libraryArtworkCandidates({ ...game, capsule_image: null })).toEqual([]);
  });

  it("picks the cover size from the card width and pixel ratio", () => {
    expect(coverTierFor(180, 1)).toBe("1x");
    expect(coverTierFor(300, 1)).toBe("1x");
    expect(coverTierFor(220, 1.5)).toBe("2x");
    expect(coverTierFor(160, 2)).toBe("2x");
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
