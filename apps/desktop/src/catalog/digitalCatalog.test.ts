import { describe, expect, it, vi } from "vitest";
import { DigitalCatalog } from "./DigitalCatalog";
import type { CatalogGame } from "../types";

describe("DigitalCatalog", () => {
  const sampleGame: CatalogGame = {
    id: 999,
    slug: "sample-game",
    name: "Sample Game",
    app_id: 999,
    credit_cost_per_hour: 0,
    copies_total: 1,
    copies_available: 1,
    availability_state: "ready",
    downloadSource: "magnet:?xt=urn:btih:sample999",
  };

  it("loads games from configured catalogLoader", async () => {
    const service = new DigitalCatalog({
      catalogLoader: async () => [sampleGame],
    });
    const games = await service.loadCatalog();
    expect(games.length).toBe(1);
    expect(games[0].id).toBe(999);
    expect(games[0].name).toBe("Sample Game");
  });

  it("loads details in standard GameDetails format", async () => {
    const service = new DigitalCatalog({
      catalogLoader: async () => [sampleGame],
    });
    const details = await service.loadDetails(999);
    expect(details.id).toBe(999);
    expect(details.name).toBe("Sample Game");
    expect(details.steam).toBeDefined();
    expect(details.metadata_state).toBeDefined();
  });

  it("delegates play separately from GameAccess leasing", async () => {
    const playSpy = vi.fn();
    const service = new DigitalCatalog({
      playHandler: playSpy,
    });
    await service.play(sampleGame);
    expect(playSpy).toHaveBeenCalledWith(sampleGame);
  });

  it("delegates download separately from GameAccess staging", async () => {
    const downloadSpy = vi.fn();
    const service = new DigitalCatalog({
      downloadHandler: downloadSpy,
    });
    await service.download(sampleGame);
    expect(downloadSpy).toHaveBeenCalledWith(sampleGame);
  });

  it("delegates uninstall directly", async () => {
    const uninstallSpy = vi.fn();
    const service = new DigitalCatalog({
      uninstallHandler: uninstallSpy,
    });
    await service.uninstall(sampleGame);
    expect(uninstallSpy).toHaveBeenCalledWith(sampleGame);
  });

  it("delegates isInstalled directly", async () => {
    const isInstalledSpy = vi.fn().mockResolvedValue(true);
    const service = new DigitalCatalog({
      isInstalledHandler: isInstalledSpy,
    });
    const installed = await service.isInstalled(sampleGame);
    expect(installed).toBe(true);
    expect(isInstalledSpy).toHaveBeenCalledWith(sampleGame);
  });

  it("delegates openInstallFolder directly", async () => {
    const folderSpy = vi.fn();
    const service = new DigitalCatalog({
      openFolderHandler: folderSpy,
    });
    await service.openInstallFolder(sampleGame);
    expect(folderSpy).toHaveBeenCalledWith(sampleGame);
  });

  it("filters out invalid records that lack download sources", async () => {
    const gameWithSource = {
      ...sampleGame,
      id: 101,
      app_id: 101,
      name: "Valid Game",
      downloadSource: "magnet:?xt=urn:btih:valid123",
    };
    const gameWithoutSource = {
      ...sampleGame,
      id: 102,
      app_id: 102,
      name: "Invalid Game No Source",
      downloadSource: "",
    };
    const gameWithWhitespace = {
      ...sampleGame,
      id: 103,
      app_id: 103,
      name: "Invalid Game Whitespace",
      downloadSource: "   ",
    };
    const gameWithUndefined = {
      ...sampleGame,
      id: 104,
      app_id: 104,
      name: "Invalid Game Undefined",
      downloadSource: undefined,
    };
    const service = new DigitalCatalog({
      catalogLoader: async () => [
        gameWithSource as any,
        gameWithoutSource as any,
        gameWithWhitespace as any,
        gameWithUndefined as any,
      ],
    });
    const games = await service.loadCatalog();
    expect(games.length).toBe(1);
    expect(games[0].id).toBe(101);
    expect(games[0].name).toBe("Valid Game");
  });

  it("provides proper error feedback when downloading a game without download sources", async () => {
    const service = new DigitalCatalog();
    const gameNoSource: CatalogGame = {
      ...sampleGame,
      id: 888,
      app_id: 888,
      name: "Game Without Source",
      downloadSource: "",
    };
    await expect(service.download(gameNoSource)).rejects.toThrow(
      "El juego 'Game Without Source' no tiene fuentes de descarga configuradas."
    );
  });

  it("loads default bundled catalog filtering out games with empty download sources", async () => {
    const service = new DigitalCatalog();
    const games = await service.loadCatalog();
    expect(games.length).toBeGreaterThan(0);
    // All returned games must have valid records with downloadSource
    for (const g of games) {
      const rec = service.getRecord(g.id);
      expect(rec).toBeDefined();
      expect(rec?.downloadSource.trim().length).toBeGreaterThan(0);
    }
  });
});
