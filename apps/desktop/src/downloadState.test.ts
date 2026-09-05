import { describe, expect, it } from "vitest";

import type { SteamDownloadStatus } from "./native";
import { reconcileDownloadMaps, reconcileDownloadStatus, reconcileSteamAndProviderStatus } from "./downloadState";

const status = (overrides: Partial<SteamDownloadStatus>): SteamDownloadStatus => ({
  app_id: 42,
  state: "unknown",
  progress: null,
  bytes_downloaded: null,
  bytes_total: null,
  installed: false,
  ...overrides,
});

describe("installation/download reconciliation", () => {
  it("keeps a fresh Steam installation when the provider cache says not installed", () => {
    const steam = status({ state: "installed", installed: true, progress: 100 });
    const provider = status({ state: "not-installed", error: "old provider probe failed" });
    const result = reconcileSteamAndProviderStatus(steam, provider);
    expect(result.state).toBe("installed");
    expect(result.installed).toBe(true);
  });

  it("keeps a fresh Steam installation when the provider cache cannot be parsed", () => {
    const steam = status({ state: "installed", installed: true, progress: 100 });
    expect(reconcileSteamAndProviderStatus(steam, null)).toEqual(steam);
  });

  it("does not let a late estimate degrade an installed map entry", () => {
    const installed = status({ state: "installed", installed: true, progress: 100 });
    const estimate = status({ state: "not-installed", bytes_total: 1_000_000 });
    const merged = reconcileDownloadMaps({ 42: installed }, { 42: estimate });
    expect(merged[42].state).toBe("installed");
    expect(merged[42].installed).toBe(true);
    expect(merged[42].bytes_total).toBe(1_000_000);
  });

  it("keeps transfer state separate from installation evidence during an update", () => {
    const installed = status({ state: "installed", installed: true, progress: 100 });
    const transfer = status({ state: "downloading", progress: 25, bytes_downloaded: 250, bytes_total: 1000 });
    const merged = reconcileDownloadStatus(installed, transfer)!;
    expect(merged.state).toBe("downloading");
    expect(merged.installed).toBe(true);
    expect(merged.progress).toBe(25);
  });

  it("requires a concrete provider target before a provider-only installed cache is trusted", () => {
    const steam = status({ state: "not-installed" });
    const staleProvider = status({ state: "installed", installed: true, prepared_target: null });
    expect(reconcileSteamAndProviderStatus(steam, staleProvider).state).toBe("not-installed");

    const validatedProvider = status({ state: "installed", installed: true, prepared_target: "C:/Games/42" });
    expect(reconcileSteamAndProviderStatus(steam, validatedProvider).state).toBe("installed");
  });
});
