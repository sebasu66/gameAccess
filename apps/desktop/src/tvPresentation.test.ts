import { describe, expect, it } from "vitest";
import { selectedHero, selectedMovie, selectedVideo } from "./LibraryRoomParts";
import type { CatalogGame, GameDetails } from "./types";

const game = { id: 1, slug: "g", name: "Game", app_id: 1, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, hero_image: "game-hero.jpg", header_image: "header.jpg" } as CatalogGame;

describe("room TV game presentation fallback", () => {
  it("has an immediate game-art fallback while Steam details are loading", () => {
    expect(selectedHero(null, game)).toBe("header.jpg");
  });
  it("prefers full-resolution Steam screenshots when details arrive", () => {
    const details = { steam: { screenshots: [{ id: 1, full: "1920.jpg", thumbnail: "thumb.jpg" }] } } as GameDetails;
    expect(selectedHero(details, game)).toBe("1920.jpg");
  });
  it("selects a highlight movie and its mp4 source", () => {
    const details = { steam: { movies: [{ id: 1, name: "A", highlight: false, mp4: "a.mp4" }, { id: 2, name: "B", highlight: true, mp4: "b.mp4" }] } } as GameDetails;
    expect(selectedVideo(selectedMovie(details))).toBe("b.mp4");
  });
});


describe("TV selected-game fallback prevents stale artwork", () => {
  it("uses the selected game header while richer Steam metadata is unavailable", () => {
    expect(selectedHero(null, game)).toBe("header.jpg");
  });
});
