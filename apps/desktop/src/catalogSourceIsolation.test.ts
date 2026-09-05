import { describe, expect, it } from "vitest";
import apiSource from "./api.ts?raw";
import roomSource from "./LibraryRoom.tsx?raw";


describe("catalog source isolation", () => {
  it("never falls from GameAccess details into the cached local catalog", () => {
    expect(apiSource).not.toContain("if (findLocalGameForDetails(gameId)) return loadLocalDetails(gameId)");
    expect(apiSource).toContain('const game = getCatalogMode() === "local"');
  });

  it("does not estimate provider size when merely selecting a game", () => {
    expect(roomSource).not.toContain("providerDownloadEstimate");
    expect(roomSource).not.toContain("estimatesByAppId");
  });
});
