import { describe, expect, it } from "vitest";
import {
  snapshotToManagedStatus,
  type DownloadProgressSnapshot,
  type IDownloadProvider,
} from "./downloadProvider";
import { getDownloadStatusLabel } from "./GenericDownloadProgress";
import type { CatalogGame } from "./types";

class MockArchiveDownloadProvider implements IDownloadProvider {
  readonly name = "mock-archive";
  private snapshots = new Map<number, DownloadProgressSnapshot>();

  canHandle(game: CatalogGame): boolean {
    return Boolean(game.app_id);
  }

  async start(game: CatalogGame): Promise<void> {
    this.snapshots.set(game.id, {
      gameId: game.id,
      phase: "preparing",
      progress: 0,
      statusText: "Preparing download...",
    });
  }

  async cancel(gameId: number): Promise<void> {
    this.snapshots.set(gameId, {
      gameId,
      phase: "cancelled",
      progress: 0,
    });
  }

  async getStatus(gameId: number): Promise<DownloadProgressSnapshot> {
    return this.snapshots.get(gameId) ?? {
      gameId,
      phase: "preparing",
      progress: 0,
    };
  }

  simulateDecompressing(gameId: number, progress: number, statusText?: string) {
    this.snapshots.set(gameId, {
      gameId,
      phase: "decompressing",
      progress,
      statusText,
      bytesDownloaded: 500_000_000,
      bytesTotal: 1_000_000_000,
      speedBps: 20_000_000,
      etaSeconds: 25,
    });
  }
}

describe("IDownloadProvider & compliance with visual components", () => {
  it("converts DownloadProgressSnapshot to ManagedDownloadStatus seamlessly", () => {
    const provider = new MockArchiveDownloadProvider();
    provider.simulateDecompressing(42, 60, "Decompressing asset pack 2/3");

    const snapshot = {
      gameId: 42,
      phase: "decompressing" as const,
      progress: 60,
      statusText: "Decompressing asset pack 2/3",
      bytesDownloaded: 600,
      bytesTotal: 1000,
      speedBps: 50,
      etaSeconds: 8,
    };

    const managed = snapshotToManagedStatus(snapshot);
    expect(managed.app_id).toBe(42);
    expect(managed.state).toBe("decompressing");
    expect(managed.statusText).toBe("Decompressing asset pack 2/3");
    expect(managed.progress).toBe(60);
    expect(managed.bytes_downloaded).toBe(600);
    expect(managed.bytes_total).toBe(1000);
    expect(managed.speed_bps).toBe(50);
    expect(managed.eta_seconds).toBe(8);

    // Visual component status label resolves the custom statusText or phase
    const label = getDownloadStatusLabel(managed);
    expect(label).toBe("Decompressing asset pack 2/3");
  });

  it("maps completed phase to installed state for the UI", () => {
    const completedSnapshot: DownloadProgressSnapshot = {
      gameId: 100,
      phase: "completed",
      progress: 100,
    };
    const managed = snapshotToManagedStatus(completedSnapshot);
    expect(managed.installed).toBe(true);
    expect(managed.state).toBe("installed");
    expect(managed.progress).toBe(100);
  });
});
