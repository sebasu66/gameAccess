import { describe, expect, it } from "vitest";
import source from "./api.ts?raw";

describe("GameAccess lease guard", () => {
  it("blocks a second GameAccess lease only while a tracked Steam game session is active", () => {
    expect(source).toContain("getSteamSessionStatus");
    expect(source).toContain("session.appId && !session.done");
    expect(source).toContain("Ya hay un juego en ejecución. Cerralo antes de iniciar otro.");
  });

  it("explicitly asks the backend to replace a stale active lease", () => {
    expect(source).toContain("replace_existing: true");
  });

  it("hands only the lease id and backend URL to native provider login", () => {
    expect(source).toContain("loginProviderSteam(lease.lease_id, apiBaseUrl)");
    expect(source).not.toContain("const credentials = await request");
    expect(source).not.toContain("expectedUserId32: number");
  });
});
