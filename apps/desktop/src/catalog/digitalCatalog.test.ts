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
});
