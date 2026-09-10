import { describe, expect, it } from "vitest";

import { downloadManager } from "./downloadManager";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const games: CatalogGame[] = [
  { id: 1, slug: "alpha", name: "Alpha", app_id: 10, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 },
  { id: 2, slug: "beta", name: "Beta", app_id: 20, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 },
  { id: 3, slug: "gamma", name: "Gamma", app_id: 30, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 },
];

const installed: SteamDownloadStatus = {
  app_id: 20, state: "installed", progress: 100,
  bytes_downloaded: 100, bytes_total: 100, installed: true,
};

const prepared: SteamDownloadStatus = {
  app_id: 20, state: "prepared", progress: 100,
  bytes_downloaded: 100, bytes_total: 100, installed: false,
};

const missing: SteamDownloadStatus = {
  app_id: 20, state: "not-installed", progress: null,
  bytes_downloaded: null, bytes_total: null, installed: false,
};

describe("DownloadManager", () => {
  it("pins a requested download to the first grid slot", () => {
    const downloads = { 20: downloadManager.requestedStatus(20) };
    expect(downloadManager.pinGames(games, downloads, [20]).map((game) => game.id)).toEqual([2, 1, 3]);
  });

  it("releases an installed game back to its normal position", () => {
    expect(downloadManager.pinGames(games, { 20: installed }, []).map((game) => game.id)).toEqual([1, 2, 3]);
  });

  it("does not mistake the Steam confirmation delay for cancellation", () => {
    expect(downloadManager.shouldReleaseMissing(missing, false, 8, 12_000)).toBe(false);
    expect(downloadManager.shouldReleaseMissing(missing, false, 20, 91_000)).toBe(true);
  });

  it("releases a download after activity disappears twice", () => {
    expect(downloadManager.shouldReleaseMissing(missing, true, 1, 5_000)).toBe(false);
    expect(downloadManager.shouldReleaseMissing(missing, true, 2, 7_500)).toBe(true);
  });

  it("treats both installed and prepared as completed managed downloads", () => {
    expect(downloadManager.didJustComplete("downloading", installed)).toBe(true);
    expect(downloadManager.didJustComplete("preparing", prepared)).toBe(true);
    expect(downloadManager.didJustComplete(undefined, installed)).toBe(false);
    expect(downloadManager.didJustComplete("installed", installed)).toBe(false);
  });

  it("shows unknown Steam size and ETA as passive missing data", () => {
    expect(downloadManager.formatBytes(null)).toBe("—");
    expect(downloadManager.formatEta(undefined)).toBe("—");
  });
});
