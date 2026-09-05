import { describe, expect, it } from "vitest";

import {
  didDownloadJustComplete,
  formatDownloadBytes,
  formatDownloadEta,
  pinDownloadingGames,
  requestedDownloadStatus,
  shouldReleaseMissingDownload,
} from "./downloadManager";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const games: CatalogGame[] = [
  { id: 1, slug: "alpha", name: "Alpha", app_id: 10, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 },
  { id: 2, slug: "beta", name: "Beta", app_id: 20, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 },
  { id: 3, slug: "gamma", name: "Gamma", app_id: 30, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 },
];

const installed: SteamDownloadStatus = {
  app_id: 20,
  state: "installed",
  progress: 100,
  bytes_downloaded: 100,
  bytes_total: 100,
  installed: true,
};

const missing: SteamDownloadStatus = {
  app_id: 20,
  state: "not-installed",
  progress: null,
  bytes_downloaded: null,
  bytes_total: null,
  installed: false,
};

describe("Steam download manager", () => {
  it("pins a requested download to the first grid slot", () => {
    const downloads = { 20: requestedDownloadStatus(20) };
    expect(pinDownloadingGames(games, downloads, [20]).map((game) => game.id)).toEqual([2, 1, 3]);
  });

  it("releases an installed game back to its normal position", () => {
    expect(pinDownloadingGames(games, { 20: installed }, []).map((game) => game.id)).toEqual([1, 2, 3]);
  });

  it("does not mistake the Steam confirmation delay for cancellation", () => {
    expect(shouldReleaseMissingDownload(missing, false, 8, 12_000)).toBe(false);
    expect(shouldReleaseMissingDownload(missing, false, 20, 91_000)).toBe(true);
  });

  it("releases a download after Steam had activity and then disappears twice", () => {
    expect(shouldReleaseMissingDownload(missing, true, 1, 5_000)).toBe(false);
    expect(shouldReleaseMissingDownload(missing, true, 2, 7_500)).toBe(true);
  });

  it("detects a real active-to-installed transition for the play-now dialog", () => {
    expect(didDownloadJustComplete("downloading", installed)).toBe(true);
    expect(didDownloadJustComplete("preparing", installed)).toBe(true);
    expect(didDownloadJustComplete(undefined, installed)).toBe(false);
    expect(didDownloadJustComplete("installed", installed)).toBe(false);
  });

  it("shows unknown Steam size and ETA as passive missing data", () => {
    expect(formatDownloadBytes(null)).toBe("—");
    expect(formatDownloadEta(undefined)).toBe("—");
  });
});
