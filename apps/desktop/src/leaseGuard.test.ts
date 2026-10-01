import { describe, expect, it } from "vitest";
import source from "./api.ts?raw";

describe("GameAccess lease replacement", () => {
  it("does not block a new GameAccess lease from stale local Steam session state", () => {
    expect(source).not.toContain("getSteamSessionStatus");
    expect(source).not.toContain("session.appId && !session.done");
    expect(source).not.toContain("Ya hay un juego en ejecución. Cerralo antes de iniciar otro.");
  });

  it("always asks the backend to replace any active lease", () => {
    expect(source).toContain("replace_existing: true");
  });

  it("hands only the lease id and backend URL to native provider login", () => {
    expect(source).toContain("loginProviderSteam(lease.lease_id, apiBaseUrl)");
    expect(source).not.toContain("const credentials = await request");
    expect(source).not.toContain("expectedUserId32: number");
  });
});
