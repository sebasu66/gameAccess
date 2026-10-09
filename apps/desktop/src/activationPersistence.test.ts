import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("./settings", () => ({
  getApiBaseUrl: async () => "https://example.test",
  boundedFetch: (fetcher: typeof fetch) => fetcher,
}));
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  storage = new Map([["gameaccess:installation-id", "installation-test"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
function server(cacheable: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/redeem")
      ? { session_token: "test-session-token-long-enough", expires_at: "2030-01-01T00:00:00Z", cacheable }
      : { active: true, expires_at: "2030-01-01T00:00:00Z", server_time: "2026-10-09T00:00:00Z", cacheable }
  ), { status: 200 })));
}
describe("activation persistence policy", () => {
  it("stores a regular pass, restores it after restart and clears it on expiry", async () => {
    server(true);
    let activation = await import("./activation");
    await activation.redeemActivation("GA-REGULAR-TEST");
    expect(activation.getRegularAccess()?.key).toBe("GA-REGULAR-TEST");
    vi.resetModules();
    activation = await import("./activation");
    const token = await activation.readActivationSession();
    expect(token).toBe("test-session-token-long-enough");
    await activation.checkActivation(token!);
    expect(activation.getRegularAccess()?.key).toBe("GA-REGULAR-TEST");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: { reason: "expired" } }), { status: 401 })));
    await expect(activation.checkActivation(token!)).rejects.toMatchObject({ end: { reason: "expired" } });
    expect(storage.has("gameaccess:regular-access")).toBe(false);
    expect(activation.getRegularAccess()).toBeNull();
  });
  it("removes old cached courtesy credentials, uses RAM while open, and asks again after restart", async () => {
    server(false);
    storage.set("gameaccess:regular-access", JSON.stringify({ session_token: "old-courtesy-token", key: "old-private-key" }));
    storage.set("gameaccess:last-activation-status", "{}");
    let activation = await import("./activation");
    await activation.checkActivation("old-courtesy-token");
    expect(await activation.readActivationSession()).toBe("old-courtesy-token");
    expect(activation.activationHeaders().Authorization).toBe("Bearer old-courtesy-token");
    expect(storage.has("gameaccess:regular-access")).toBe(false);
    expect(storage.has("gameaccess:last-activation-status")).toBe(false);
    expect(activation.getRegularAccess()).toBeNull();
    await activation.redeemActivation("GA-PRIVATE-TEST");
    expect([...storage.values()].join(" ")).not.toContain("GA-PRIVATE-TEST");
    vi.resetModules();
    activation = await import("./activation");
    expect(await activation.readActivationSession()).toBeNull();
  });
  it("keeps unknown server policies ephemeral rather than saving private credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      session_token: "test-session-token-long-enough", active: true,
      expires_at: "2030-01-01T00:00:00Z", server_time: "2026-10-09T00:00:00Z",
    }))));
    const activation = await import("./activation");
    await activation.redeemActivation("GA-UNKNOWN-TEST");
    expect(storage.has("gameaccess:regular-access")).toBe(false);
    expect(activation.getRegularAccess()).toBeNull();
  });
  it("passes the server policy to Windows and never passes a courtesy key to storage", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    invoke.mockImplementation(async (command: string) => command === "activation_installation_id" ? "native-installation" : null);
    server(false);
    const activation = await import("./activation");
    await activation.redeemActivation("GA-PRIVATE-TEST");
    const writes = invoke.mock.calls.filter(([command]) => command === "activation_save_session");
    expect(writes.length).toBeGreaterThan(0);
    for (const [, payload] of writes) expect(payload).toEqual({
      sessionToken: "test-session-token-long-enough", persistent: false, accessKey: null,
    });
    invoke.mockClear();
    server(true);
    await activation.redeemActivation("GA-REGULAR-TEST");
    expect(invoke).toHaveBeenCalledWith("activation_save_session", {
      sessionToken: "test-session-token-long-enough", persistent: true, accessKey: "GA-REGULAR-TEST",
    });
  });
});
