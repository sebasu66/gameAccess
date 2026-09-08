import { describe, expect, it } from "vitest";

import { normalizeSteamStoreMetadata } from "./steamMetadata";
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
