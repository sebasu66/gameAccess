import { describe, expect, it } from "vitest";

import { mergeLocalSteamDetails, normalizeSteamStoreMetadata } from "./steamMetadata";
import type { CatalogGame } from "./types";

const game: CatalogGame = {
  id: 10,
  slug: "steam-10",
  name: "Fallback title",
  app_id: 10,
  credit_cost_per_hour: 0,
  copies_total: 1,
  copies_available: 1,
};

describe("Steam Store metadata normalization", () => {
  it("calculates local ratings while preserving catalog identity and installation commands", () => {
    const base = { ...game, downloadSource: "local-source", playProcess: "existing-command", steam: null, metadata_state: "digital" };
    const refreshed = mergeLocalSteamDetails(base, {
      name: "Steam title", genres: [{ description: "RPG" }],
      release_date: { date: "5 OCT 2026" },
      gameaccess_reviews: { total_reviews: 200, total_positive: 180 },
    });
    expect(refreshed).toMatchObject({ id: 10, name: "Fallback title", downloadSource: "local-source", playProcess: "existing-command", steam_review_score: 90, steam_review_count: 200 });
    expect(refreshed.steam?.release_date).toBe("5 OCT 2026");
  });

  it("preserves existing ratings when review fetches fail or totals are invalid", () => {
    const base = { ...game, steam_review_score: 85, steam_review_count: 100, steam: null, metadata_state: "ready" };
    for (const summary of [undefined, { total_reviews: 10, total_positive: 11 }, { total_reviews: -1, total_positive: 0 }]) {
      expect(mergeLocalSteamDetails(base, { gameaccess_reviews: summary })).toMatchObject({ steam_review_score: 85, steam_review_count: 100 });
    }
    expect(mergeLocalSteamDetails(base, { gameaccess_reviews: { total_reviews: 0, total_positive: 0 } })).toMatchObject({ steam_review_score: null, steam_review_count: 0 });
  });
  it("preserves the existing metadata contract after extracting it from api.ts", () => {
    const metadata = normalizeSteamStoreMetadata(game, {
      name: "Store title",
      platforms: { windows: true, linux: false },
      genres: [{ description: "RPG" }],
      price_overview: { currency: "USD", final: 1999, discount_percent: 20 },
      movies: [{ id: 1, name: "Trailer", mp4: { max: "https://cdn.example/trailer.mp4" }, highlight: true }],
      screenshots: [{ id: 2, path_full: "https://cdn.example/full.jpg" }],
    });

    expect(metadata.name).toBe("Store title");
    expect(metadata.windows).toBe(true);
    expect(metadata.genres).toEqual(["RPG"]);
    expect(metadata.price).toMatchObject({ currency: "USD", final: 1999, discount_percent: 20 });
    expect(metadata.movies?.[0]).toMatchObject({ name: "Trailer", mp4: "https://cdn.example/trailer.mp4", highlight: true });
    expect(metadata.screenshots?.[0].full).toBe("https://cdn.example/full.jpg");
  });
});
