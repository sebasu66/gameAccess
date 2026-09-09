import { describe, expect, it } from "vitest";
import apiSource from "./api.ts?raw";
import roomSource from "./LibraryRoom.tsx?raw";


describe("catalog source isolation", () => {
  it("keeps Propios and GameAccess license routes completely separate", () => {
    expect(apiSource).not.toContain("mergeLocalWithBackendCatalog");
    expect(apiSource).not.toContain("local route failed; trying the backend route");
    expect(apiSource).not.toContain("game.backend_game_id");
    expect(apiSource).toContain("Using Propios. This tab never reads or merges GameAccess provider licenses.");
    expect(apiSource).toContain('if (mode === "local")');
    expect(apiSource).toContain('if (mode !== "gameaccess")');
  });

  it("never falls from GameAccess details into the cached local catalog", () => {
    expect(apiSource).not.toContain("if (findLocalGameForDetails(gameId)) return loadLocalDetails(gameId)");
    expect(apiSource).toContain('if (getCatalogMode() === "local") return loadLocalDetails(gameId)');
  });

  it("does not estimate provider size when merely selecting a game", () => {
    expect(roomSource).not.toContain("providerDownloadEstimate");
    expect(roomSource).not.toContain("estimatesByAppId");
  });
});
