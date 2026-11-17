import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";

describe("pending Steam metadata refresh", () => {
  it("refreshes unresolved Steam cards in background without blocking navigation", () => {
    expect(appSource).toContain("const isPendingSteamMetadata");
    expect(appSource).toContain("games.some(isPendingSteamMetadata)");
    expect(appSource).toContain("refreshPendingMetadata");
    expect(appSource).toContain("timer = window.setTimeout(() => void loop(), delay)");
  });
});
