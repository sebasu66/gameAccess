import { describe, expect, it } from "vitest";

import providerDownloadSource from "../src-tauri/src/provider_download.rs?raw";
import tauriMainSource from "../src-tauri/src/main.rs?raw";
import libraryRoomSource from "./LibraryRoom.tsx?raw";
import { selectedMovie, selectedVideo } from "./LibraryRoomParts";
import type { GameDetails } from "./types";

describe("UI thread isolation contract", () => {
  it("keeps provider size estimation and download startup off the Tauri command thread", () => {
    expect(providerDownloadSource).toContain("pub async fn provider_download_estimate");
    expect(providerDownloadSource).toContain("spawn_blocking(move || provider_download_estimate_blocking(app_id))");
    expect(providerDownloadSource).toContain("pub async fn start_provider_download");
    expect(providerDownloadSource).toContain("spawn_blocking(move || start_provider_download_blocking(app_id))");
  });

  it("keeps selected-game detail loading asynchronous and cancellable", () => {
    expect(libraryRoomSource).toContain("loadDetails(requestedGameId)");
    expect(libraryRoomSource).toContain(".then((value)");
    expect(libraryRoomSource).toContain("let cancelled = false;");
    expect(libraryRoomSource).not.toMatch(/await\s+loadDetails\(requestedGameId\)/);
  });

  it("keeps Steam Store metadata off the blocking Tauri command path", () => {
    expect(tauriMainSource).toContain("async fn steam_store_metadata");
    expect(tauriMainSource).toContain("spawn_blocking(move || native_core::steam_store_metadata(app_id))");
  });

  it("uses Steam Store movies as the library hero video source", () => {
    const details = {
      steam: {
        movies: [
          { id: 1, name: "Gameplay", mp4: "https://cdn.example/gameplay.mp4", highlight: false },
          { id: 2, name: "Trailer", webm: "https://cdn.example/trailer.webm", highlight: true },
        ],
      },
    } as GameDetails;

    const movie = selectedMovie(details);
    expect(movie?.id).toBe(2);
    expect(selectedVideo(movie)).toBe("https://cdn.example/trailer.webm");
  });
});
