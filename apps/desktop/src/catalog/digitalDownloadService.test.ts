import { describe, expect, it, vi } from "vitest";
import { DigitalDownloadService } from "./DigitalDownloadService";
import type { CatalogGame } from "../types";
import type { DigitalGameRecord } from "./DigitalCatalog";

describe("DigitalDownloadService", () => {
  const sampleGame: CatalogGame = {
    id: 2592160,
    slug: "dispatch",
    name: "Dispatch",
    app_id: 2592160,
    credit_cost_per_hour: 0,
    copies_total: 1,
    copies_available: 1,
    availability_state: "ready",
  };

  const sampleRecord: DigitalGameRecord = {
    id: 2592160,
    name: "Dispatch",
    downloadSource: "https://example.com/dispatch.zip",
    installProcess: "python setup.py",
    playProcess: "dispatch.exe",
    uninstallProcess: "clean.bat",
  };

  it("registers and retrieves digital game records with the 5 JSON properties", () => {
    const service = new DigitalDownloadService();
    service.registerRecords([sampleRecord]);

    const retrieved = service.getRecord(2592160);
    expect(retrieved).toBeDefined();
    expect(retrieved?.downloadSource).toBe("https://example.com/dispatch.zip");
    expect(retrieved?.installProcess).toBe("python setup.py");
    expect(retrieved?.playProcess).toBe("dispatch.exe");
    expect(retrieved?.uninstallProcess).toBe("clean.bat");
  });

  it("updates progress snapshots and notifies subscribers", async () => {
    const service = new DigitalDownloadService();
    service.registerRecords([sampleRecord]);

    const listener = vi.fn();
    const unsubscribe = service.subscribe(2592160, listener);

    service.updateSnapshot({
      gameId: 2592160,
      phase: "downloading",
      progress: 45,
      statusText: "Downloading Dispatch...",
      bytesDownloaded: 450_000_000,
      bytesTotal: 1_000_000_000,
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "downloading",
        progress: 45,
      })
    );

    const managed = service.getManagedStatus(2592160);
    expect(managed).toBeDefined();
    expect(managed?.state).toBe("downloading");
    expect(managed?.progress).toBe(45);

    unsubscribe();
  });

  it("transitions to cancelled on cancel", async () => {
    const service = new DigitalDownloadService();
    service.updateSnapshot({ gameId: 2592160, phase: "queued", progress: 0 });
    await service.cancel(2592160);

    const status = await service.getStatus(2592160);
    expect(status.phase).toBe("cancelled");
  });
});
