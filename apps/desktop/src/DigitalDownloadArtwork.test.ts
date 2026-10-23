import { describe, expect, it } from "vitest";
import { downloadArtworkCandidates } from "./DigitalDownloadArtwork";
import type { CatalogGame } from "./types";

describe("Digital download artwork", () => {
  it("keeps catalog artwork first and offers alternatives for a broken header", () => {
    const game = { id: 1, app_id: 42, header_image: " custom-header.jpg ", hero_image: "hero.jpg", capsule_image: "cover.jpg" } as CatalogGame;
    const sources = downloadArtworkCandidates(game);
    expect(sources[0]).toBe("custom-header.jpg");
    expect(sources).toContain("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/header.jpg");
    expect(sources.slice(-2)).toEqual(["hero.jpg", "cover.jpg"]);
  });
  it("uses available catalog images without treating a Digital id as a Steam id", () => {
    expect(downloadArtworkCandidates({ id: 999, header_image: " ", capsule_image: "cover.jpg" } as CatalogGame)).toEqual(["cover.jpg"]);
  });
  it("deduplicates sources and allows an icon fallback when none exist", () => {
    expect(downloadArtworkCandidates({ id: 1, header_image: "same.jpg", capsule_image: "same.jpg" } as CatalogGame)).toEqual(["same.jpg"]);
    expect(downloadArtworkCandidates({ id: 1 } as CatalogGame)).toEqual([]);
  });
});
