import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { supplyArchivePasswords } from "./archivePasswords";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../activation", () => ({ getInstallationId: vi.fn().mockResolvedValue("installation"), readActivationSession: vi.fn().mockResolvedValue("session") }));
vi.mock("../settings", () => ({ getApiBaseUrl: vi.fn().mockResolvedValue("https://fixture.invalid") }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("central archive password delivery", () => {
  it("requests authenticated passwords and forwards them only to the worker bridge", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ passwords: ["first", "second"] }) });
    vi.stubGlobal("fetch", fetchMock);
    await supplyArchivePasswords(1912410);
    expect(fetchMock).toHaveBeenCalledWith("https://fixture.invalid/digital/archive-passwords", expect.objectContaining({ cache: "no-store", headers: { Authorization: "Bearer session", "X-GameAccess-Installation": "installation" } }));
    expect(invoke).toHaveBeenCalledWith("supply_digital_archive_passwords", { appId: 1912410, passwords: ["first", "second"], error: null });
  });
  it("delivers server failures to the worker so it reports an error instead of hanging", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(supplyArchivePasswords(1912410)).rejects.toThrow("HTTP 401");
    expect(invoke).toHaveBeenCalledWith("supply_digital_archive_passwords", { appId: 1912410, passwords: [], error: "El servidor no pudo entregar las contraseñas (HTTP 401)." });
  });
});
