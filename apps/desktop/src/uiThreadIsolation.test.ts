import { describe, expect, it } from "vitest";

import tauriMainSource from "../src-tauri/src/main.rs?raw";
import appSource from "./App.tsx?raw";
import libraryRoomSource from "./LibraryRoom.tsx?raw";
import { selectedMovie, selectedVideo } from "./LibraryRoomParts";
import type { GameDetails } from "./types";

describe("UI thread isolation contract", () => {

  it("keeps selected-game detail loading asynchronous and cancellable", () => {
    expect(libraryRoomSource).toContain("loadDetails(requestedGameId)");
    expect(libraryRoomSource).toContain(".then((value)");
    expect(libraryRoomSource).toContain("let cancelled = false;");
    expect(libraryRoomSource).not.toMatch(/await\s+loadDetails\(requestedGameId\)/);
  });

  it("does not fan out heavy details or per-game download probes at catalog startup", () => {
    expect(appSource).not.toContain("games.slice(0, 8)");
    expect(appSource).not.toContain("games.slice(0, 24)");
    expect(appSource).toContain("steamInstalledAppIds()");
    expect(libraryRoomSource).toContain("detailRequestedGameId === selectedGameIdResolved");
  });

  it("keeps Steam Store metadata off the blocking Tauri command path", () => {
    expect(tauriMainSource).toContain("async fn steam_store_metadata");
    expect(tauriMainSource).toContain("spawn_blocking(move || native_core::steam_store_metadata_refresh(app_id, force.unwrap_or(false)))");
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
