import { describe, expect, it } from "vitest";
import apiSource from "./api.ts?raw";
import lifecycleSource from "./leaseLifecycle.ts?raw";

describe("GameAccess server-owned lease policy", () => {
  it("does not use local Steam activity as lease authority", () => {
    expect(lifecycleSource).not.toContain("getSteamSessionStatus");
    expect(lifecycleSource).not.toContain("steamAccountActivity");
    expect(lifecycleSource).not.toContain("releaseActiveLease");
    expect(lifecycleSource).toContain("getProviderLeaseStatus");
  });

  it("lets the backend identify the caller from activation headers instead of user_id=1", () => {
    expect(apiSource).toContain("JSON.stringify({ game_id: gameId, minutes })");
    expect(apiSource).not.toContain("replace_existing: true");
    expect(apiSource).not.toContain("user_id: 1, game_id");
  });

  it("explains server inactivity release without closing local Steam", () => {
    expect(lifecycleSource).toContain("steam_inactive_timeout");
    expect(lifecycleSource).toContain("Steam en modo offline");
    expect(lifecycleSource).toContain("desconectando Wi-Fi");
    expect(lifecycleSource).toContain("Steam and the running game were not closed");
  });

  it("hands only the lease id and backend URL to native provider login", () => {
    expect(apiSource).toContain("loginProviderSteam(lease.lease_id, apiBaseUrl)");
    expect(apiSource).not.toContain("const credentials = await request");
  });
});
