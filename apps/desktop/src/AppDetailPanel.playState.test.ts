import { describe, expect, it } from "vitest";

import source from "./AppDetailPanel.tsx?raw";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { gameStateManager } from "./GameStateManager";

const preparedStatus: ManagedDownloadStatus = {
  app_id: 1935960,
  state: "prepared",
  progress: 100,
  bytes_downloaded: 2152951695,
  bytes_total: 2152951695,
  installed: false,
  prepared_target: "C:/Program Files (x86)/Steam/steamapps/common/Drifter's Tales",
};

describe("detail Play state", () => {
  it("treats a provider-prepared game as immediately Play-ready", () => {
    expect(gameStateManager.resolve(preparedStatus)).toMatchObject({
      prepared: true,
      installed: false,
      playButtonReady: true,
      primaryAction: "play",
    });
  });

  it("uses canonical local state instead of stale catalog copy availability to gate Play", () => {
    expect(source).toContain("const localState = gameStateManager.resolve(download);");
    expect(source).toContain("disabled={!playReady || busy}");
    expect(source).not.toContain("disabled={!installed || busy || game.copies_available <= 0}");
    expect(source).not.toContain("const installed = download?.state === \"installed\"");
  });

  it("labels terminal storage states without offering another download", () => {
    expect(source).toContain("function downloadActionLabel");
    expect(source).toContain("if (state.prepared) return \"Preparado\";");
    expect(source).toContain("if (state.frozen) return \"Congelado\";");
    expect(source).toContain("const downloadBlocked = playReady || activeDownload || localState.storageBusy;");
  });
});
