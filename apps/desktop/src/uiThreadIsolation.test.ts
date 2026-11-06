import steamCommandsSource from "../src-tauri/src/steam_commands.rs?raw";
import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";
import libraryRoomSource from "./LibraryRoom.tsx?raw";

describe("UI thread isolation contract", () => {

  it("does not fan out heavy details or per-game download probes at catalog startup", () => {
    expect(appSource).not.toContain("games.slice(0, 8)");
    expect(appSource).not.toContain("games.slice(0, 24)");
    expect(appSource).toContain("steamInstalledAppIds()");
    // The grid never loads details: the open detail loads its own (useSelectedGameDetails).
    expect(libraryRoomSource).not.toContain("loadDetails(");
  });

  it("keeps Steam Store metadata off the blocking Tauri command path", () => {
    expect(steamCommandsSource).toContain("async fn steam_store_metadata");
    expect(steamCommandsSource).toContain("spawn_blocking(move || native_core::steam_store_metadata_refresh(app_id, language, force.unwrap_or(false)))");
  });
});
