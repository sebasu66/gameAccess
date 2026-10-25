import { describe, expect, it } from "vitest";
import { isHlsSource, selectSteamTrailer, steamTrailerSource } from "./steamTrailer";
import { normalizeSteamStoreMetadata } from "./steamMetadata";
import type { CatalogGame } from "./types";

describe("Steam HLS trailers", () => {
  it("retains the HLS URL returned by Steam and selects it without MP4/WebM", () => {
    const url = "https://video.akamai.steamstatic.com/store_trailers/42/hash/hls_264_master.m3u8?t=1";
    const metadata = normalizeSteamStoreMetadata({ app_id: 42 } as CatalogGame, { movies: [{ id: 1, hls_h264: url, highlight: true }] });
    expect(steamTrailerSource(selectSteamTrailer(metadata.movies))).toBe(url);
    expect(isHlsSource(url)).toBe(true);
  });
  it("skips unavailable highlights and retains direct video support", () => {
    const movie = selectSteamTrailer([{ highlight: true }, { mp4: "https://example.test/movie.mp4" }]);
    expect(steamTrailerSource(movie)).toBe("https://example.test/movie.mp4");
    expect(isHlsSource(steamTrailerSource(movie)!)).toBe(false);
  });
});
