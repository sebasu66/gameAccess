import { afterEach, describe, expect, it, vi } from "vitest";
import { narrate, reportClientError } from "./narrationLog";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./activation", () => ({ getInstallationId: vi.fn().mockResolvedValue("fixture-installation"), readActivationSession: vi.fn().mockResolvedValue("fixture-session") }));
vi.mock("./settings", () => ({ getApiBaseUrl: vi.fn().mockResolvedValue("https://fixture.invalid") }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("client error delivery acknowledgement", () => {
  it("shares narration upload with modal confirmation and includes the failing AppID", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const message = "Digital AppID 1912410 · Minecraft Dungeons II · error: ninguna contraseña funcionó";
    await narrate(message, { area: "DIGITAL_DOWNLOAD", level: "ERROR" });
    expect(await reportClientError(message, "DIGITAL_DOWNLOAD")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.app_id).toBe(1912410);
    expect(payload.message).toContain("ninguna contraseña");
  });
  it("returns false if the server rejects an execution report", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    expect(await reportClientError("Digital AppID 42 · report rejected fixture", "DIGITAL_DOWNLOAD")).toBe(false);
  });
});
