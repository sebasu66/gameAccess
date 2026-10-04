import { describe, expect, it } from "vitest";
import {
  applyBundledCatalogArtworkFromManifest,
  applyBundledDetailsFromManifest,
  type BundledArtworkManifest,
} from "./bundledArtwork";
import type { CatalogGame, GameDetails } from "./types";

const game: CatalogGame = {
  id: 7,
  slug: "test-game",
  name: "Test Game",
  app_id: 123,
  credit_cost_per_hour: 0,
  copies_total: 1,
  copies_available: 1,
  header_image: "https://remote/header.jpg",
  capsule_image: "https://remote/capsule.jpg",
  hero_image: "https://remote/hero.jpg",
};

const manifest: BundledArtworkManifest = {
  version: 1,
  games: {
    "123": {
      header_image: "/game-assets/blobs/header.jpg",
      capsule_image: "/game-assets/blobs/capsule.jpg",
      hero_image: "/game-assets/blobs/hero.jpg",
      background: "/game-assets/blobs/background.jpg",
      screenshots: [{ id: 1, thumbnail: "/game-assets/blobs/shot-thumb.jpg", full: "/game-assets/blobs/shot.jpg" }],
      url_map: { "https://remote/rich.jpg": "/game-assets/blobs/rich.jpg" },
    },
  },
};

describe("bundled artwork", () => {
  it("prefers packaged catalog images only for AppIDs present in the manifest", () => {
    const bundled = applyBundledCatalogArtworkFromManifest(game, manifest);
    expect(bundled.capsule_image).toBe("/game-assets/blobs/capsule.jpg");
    expect(applyBundledCatalogArtworkFromManifest({ ...game, app_id: 999 }, manifest).capsule_image).toBe("https://remote/capsule.jpg");
  });

  it("rewrites still detail artwork but leaves video URLs on demand", () => {
    const details: GameDetails = {
      ...game,
      metadata_state: "ready",
      steam: {
        app_id: 123,
        name: "Test Game",
        about_the_game: '<img src="https://remote/rich.jpg">',
        screenshots: [{ id: 1, thumbnail: "https://remote/thumb.jpg", full: "https://remote/full.jpg" }],
        movies: [{ id: 9, mp4: "https://remote/video.mp4", thumbnail: "https://remote/video-poster.jpg" }],
        background: "https://remote/background.jpg",
      },
    };
    const bundled = applyBundledDetailsFromManifest(details, manifest);
    expect(bundled.steam?.screenshots?.[0].full).toBe("/game-assets/blobs/shot.jpg");
    expect(bundled.steam?.about_the_game).toContain("/game-assets/blobs/rich.jpg");
    expect(bundled.steam?.movies?.[0].mp4).toBe("https://remote/video.mp4");
    expect(bundled.steam?.movies?.[0].thumbnail).toBe("https://remote/video-poster.jpg");
  });
});
