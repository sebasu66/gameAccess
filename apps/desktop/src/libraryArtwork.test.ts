import { describe, expect, it } from "vitest";
import { libraryArtworkCandidates } from "./libraryArtwork";
import type { CatalogGame } from "./types";

const game = { id: 1, slug: "test", name: "Test", app_id: 242050, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, capsule_image: "https://example.test/low.jpg", header_image: "https://example.test/header.jpg" } as CatalogGame;

describe("Steam portrait artwork", () => {
  it("prefers the high-resolution 600x900 library portrait over legacy capsule images", () => {
    const sources = libraryArtworkCandidates(game);
    expect(sources[0]).toContain("library_600x900_2x.jpg");
    expect(sources.indexOf(game.capsule_image!)).toBeGreaterThan(0);
    expect(sources.findIndex((source) => source.includes("library_hero.jpg"))).toBeLessThan(sources.findIndex((source) => source.includes("header.jpg")));
  });
  it("keeps fallback sources unique", () => {
    const sources = libraryArtworkCandidates({ ...game, capsule_image: game.header_image });
    expect(new Set(sources).size).toBe(sources.length);
  });
});
