import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPendingClientErrors, narrate, reportClientError } from "./narrationLog";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./activation", () => ({ getInstallationId: vi.fn().mockResolvedValue("fixture-installation"), readActivationSession: vi.fn().mockResolvedValue("fixture-session") }));
vi.mock("./settings", () => ({ getApiBaseUrl: vi.fn().mockResolvedValue("https://fixture.invalid") }));
const store = new Map<string, string>();
const fakeStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
beforeEach(() => { store.clear(); vi.stubGlobal("localStorage", fakeStorage); });
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
  it("keeps a report that could not be sent and delivers it later with the time it happened", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("server asleep")));
    expect(await reportClientError("Queued fixture error", "UNCAUGHT")).toBe(false);
    expect(JSON.parse(localStorage.getItem("gameaccess:pending-client-errors") || "[]")).toHaveLength(1);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await flushPendingClientErrors();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message).toMatch(/^\[occurred \d{4}-\d{2}-\d{2}T.*\] Queued fixture error$/);
    expect(localStorage.getItem("gameaccess:pending-client-errors")).toBeNull();
  });
  it("drops a report the server refuses as invalid instead of retrying it forever", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    expect(await reportClientError("Invalid fixture report", "APP")).toBe(false);
    expect(localStorage.getItem("gameaccess:pending-client-errors")).toBeNull();
  });
});
