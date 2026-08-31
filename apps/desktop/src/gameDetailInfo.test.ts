import { describe, expect, it } from "vitest";

import {
  accountSummary,
  gameCapabilities,
  hardwareWarning,
  isSensitiveSteamContent,
  requiredStorageGb,
} from "./gameDetailInfo";
import type { CatalogGame, SteamMetadata } from "./types";

const game = (labels: string[]): CatalogGame => ({
  id: 1,
  slug: "test",
  name: "Test",
  app_id: 1,
  credit_cost_per_hour: 0,
  copies_total: labels.length,
  copies_available: labels.length,
  local_account_labels: labels,
});

const steam = (minimum_requirements: string): SteamMetadata => ({
  app_id: 1,
  minimum_requirements,
});

describe("game detail metadata", () => {
  it("summarizes multiplayer capabilities without duplicate badges", () => {
    expect(gameCapabilities([
      "Single-player",
      "Online PvP",
      "Online Co-op",
      "Shared/Split Screen PvP",
      "LAN Co-op",
      "Multi-player",
    ])).toEqual(["single", "online", "local", "lan"]);
  });

  it("shows only two ownership accounts and an ellipsis", () => {
    expect(accountSummary(game(["alpha", "beta", "gamma", "delta"]))).toEqual(["alpha", "beta", "…"]);
    expect(accountSummary(game(["alpha", "beta"]))).toEqual(["alpha", "beta"]);
  });

  it("extracts Steam storage requirements", () => {
    expect(requiredStorageGb(steam("<strong>Storage:</strong> 85 GB available space"))).toBe(85);
    expect(requiredStorageGb(steam("Almacenamiento: 5120 MB de espacio disponible"))).toBe(5);
  });

  it("warns only when the detected RAM is definitely below Steam minimum", () => {
    expect(hardwareWarning(steam("Memoria: 16 GB RAM"), { memory_gb: 8, cpu: null, gpus: [] })?.title).toContain("por debajo");
    expect(hardwareWarning(steam("Memoria: 8 GB RAM"), { memory_gb: 16, cpu: null, gpus: [] })).toBeNull();
  });

  it("protects adult sexual content and age-18 games", () => {
    expect(isSensitiveSteamContent({ app_id: 1, required_age: 18 }, null)).toBe(true);
    expect(isSensitiveSteamContent({ app_id: 1 }, { content_descriptors: { ids: [3, 5] } })).toBe(true);
    expect(isSensitiveSteamContent({ app_id: 1 }, { content_descriptors: { ids: [2, 5] } })).toBe(false);
  });
});
