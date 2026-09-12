import { describe, expect, it } from "vitest";

import { gameStateManager } from "./GameStateManager";
import type { SteamDownloadStatus } from "./native";

const status = (overrides: Partial<SteamDownloadStatus>): SteamDownloadStatus => ({
  app_id: 42, state: "unknown", progress: null,
  bytes_downloaded: null, bytes_total: null, installed: false,
  ...overrides,
});

describe("GameStateManager", () => {
  it("keeps technical state separate from Play-button readiness", () => {
    const prepared = gameStateManager.resolve(status({ state: "prepared" }));
    expect(prepared.installed).toBe(false);
    expect(prepared.prepared).toBe(true);
    expect(prepared.playButtonReady).toBe(true);
    expect(prepared.primaryAction).toBe("play");

    const frozen = gameStateManager.resolve(status({ state: "frozen" }));
    expect(frozen.installed).toBe(false);
    expect(frozen.frozen).toBe(true);
    expect(frozen.playButtonReady).toBe(true);
    expect(frozen.primaryAction).toBe("play");
  });

  it("maps active and transitional states to one primary UI action", () => {
    expect(gameStateManager.resolve(status({ state: "downloading" })).primaryAction).toBe("cancel");
    expect(gameStateManager.resolve(status({ state: "freezing" })).primaryAction).toBe("wait");
    expect(gameStateManager.resolve(status({ state: "not-installed" })).primaryAction).toBe("download");
    expect(gameStateManager.resolve(status({ state: "unknown" })).primaryAction).toBe("verify");
  });

  it("keeps a fresh Steam installation when provider cache is stale", () => {
    const steam = status({ state: "installed", installed: true, progress: 100 });
    const provider = status({ state: "not-installed", error: "old provider probe failed" });
    const result = gameStateManager.reconcileSteamAndProviderStatus(steam, provider);
    expect(result.state).toBe("installed");
    expect(result.installed).toBe(true);
  });

  it("does not let a late estimate degrade an installed map entry", () => {
    const installed = status({ state: "installed", installed: true, progress: 100 });
    const estimate = status({ state: "not-installed", bytes_total: 1_000_000 });
    const merged = gameStateManager.reconcileDownloadMaps({ 42: installed }, { 42: estimate });
    expect(merged[42].state).toBe("installed");
    expect(merged[42].installed).toBe(true);
    expect(merged[42].bytes_total).toBe(1_000_000);
  });

  it("keeps transfer state separate from installation evidence during an update", () => {
    const installed = status({ state: "installed", installed: true, progress: 100 });
    const transfer = status({ state: "downloading", progress: 25, bytes_downloaded: 250, bytes_total: 1000 });
    const merged = gameStateManager.reconcileDownloadStatus(installed, transfer)!;
    expect(merged.state).toBe("downloading");
    expect(merged.installed).toBe(true);
    expect(merged.progress).toBe(25);
  });

  it("treats provider installed cache as stale when Steam reports the game uninstalled", () => {
    const steam = status({ state: "not-installed" });
    const stale = status({
      state: "installed",
      installed: true,
      progress: 100,
      prepared_target: "C:/Program Files (x86)/Steam/steamapps/common/MK10",
    });
    const result = gameStateManager.reconcileSteamAndProviderStatus(steam, stale);
    expect(result.state).toBe("not-installed");
    expect(result.installed).toBe(false);
    expect(gameStateManager.resolve(result).primaryAction).toBe("download");
  });

  it("keeps a prepared Game Access download playable until Steam adopts it", () => {
    const steam = status({ state: "not-installed" });
    const prepared = status({
      state: "prepared",
      installed: false,
      progress: 100,
      prepared_target: "C:/Games/42",
    });
    const result = gameStateManager.reconcileSteamAndProviderStatus(steam, prepared);
    expect(result.state).toBe("prepared");
    expect(result.installed).toBe(false);
    expect(gameStateManager.resolve(result).primaryAction).toBe("play");
  });

  it("releases a stale preparing state when the worker reports terminal failure", () => {
    const base = status({ state: "preparing", job_id: "job-42" });
    const failed = status({ state: "not-installed", job_id: "job-42", error: "No verified provider" });
    const result = gameStateManager.reconcileDownloadStatus(base, failed);
    expect(result?.state).toBe("not-installed");
    expect(result?.error).toBe("No verified provider");
  });

  it("keeps Frozen authoritative over stale provider installation state", () => {
    const frozen = status({ state: "frozen", installed: false });
    const provider = status({ state: "installed", installed: true, provider_id: "provider" });
    expect(gameStateManager.reconcileSteamAndProviderStatus(frozen, provider).state).toBe("frozen");
  });
});
