import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { gameStateManager } from "./GameStateManager";

const driftersTalesPrepared: ManagedDownloadStatus = {
  app_id: 1935960,
  state: "prepared",
  progress: 100,
  bytes_downloaded: 2152951695,
  bytes_total: 2152951695,
  installed: false,
  prepared_target: "C:/Program Files (x86)/Steam/steamapps/common/Drifter's Tales",
};

describe("GameAccess library launch route", () => {
  it("keeps prepared Drifter's Tales Play-ready even when catalog availability is stale", () => {
    expect(gameStateManager.isPlayButtonReady(driftersTalesPrepared)).toBe(true);
    expect(appSource).toContain("gameStateManager.isPlayButtonReady(downloads[Number(featured?.app_id)])");
    expect(appSource).toContain("disabled={!featuredPlayReady || leaseBusy}");
    expect(appSource).not.toContain("disabled={featured.copies_available <= 0 || leaseBusy}");
  });

  it("uses the existing digital launcher without reserving provider licenses", () => {
    expect(appSource).toContain("await digitalCatalogService.play(game);");
    expect(appSource).not.toContain("openProviderSteamRun");
    expect(appSource).not.toContain("reserveLease");
  });

  it("leaves the personal/local launch route separate", () => {
    expect(appSource).toContain("await openSteamRun(game.app_id);");
  });
});
