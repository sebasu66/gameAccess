// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./activation", () => ({ ACTIVATION_CHANGED_EVENT: "gameaccess:activation-changed", getActivationTier: () => null, getInstallationId: async () => "1b4e28ba-2fa1-11d2-883f-0016d3cca427" }));
vi.mock("./settings", () => ({ getApiBaseUrl: async () => "https://api.example" }));
vi.mock("./narrationLog", () => ({ narrate: async () => undefined }));

import { getAccount, refreshAccount, registerAccount, signInAccount, signOutAccount } from "./account";

const laura = { name: "Laura", email: "laura@ejemplo.com", language: "es", plus_active: false, plus_until: null };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const asFetch = (mock: ReturnType<typeof vi.fn>) => mock as unknown as typeof fetch;

describe("player account", () => {
  beforeEach(async () => { await signOutAccount(asFetch(reply(200, {}))); });

  it("registers, remembers the session on this PC and signs out", async () => {
    const fetcher = reply(200, { token: "tok", account: laura });
    expect(await registerAccount({ name: " Laura ", email: " laura@ejemplo.com ", password: "clave-segura", language: "es" }, asFetch(fetcher))).toBe("ok");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/accounts/register");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Laura", email: "laura@ejemplo.com", password: "clave-segura", language: "es" });
    expect((init.headers as Record<string, string>)["X-GameAccess-Installation"]).toBe("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
    expect(getAccount()).toEqual(laura);
    expect(JSON.parse(localStorage.getItem("gameaccess:account") || "{}").token).toBe("tok");
    const logout = reply(200, { ok: true });
    await signOutAccount(asFetch(logout));
    expect(getAccount()).toBeNull();
    expect((logout.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("tells apart the server's answers", async () => {
    const form = { email: "laura@ejemplo.com", password: "x" };
    expect(await signInAccount(form, asFetch(reply(401, { detail: "bad_credentials" })))).toBe("bad_credentials");
    expect(await signInAccount(form, asFetch(reply(429, { detail: "too_many" })))).toBe("too_many");
    expect(await registerAccount({ ...form, name: "L", language: "es" }, asFetch(reply(409, { detail: "email_taken" })))).toBe("email_taken");
    expect(await signInAccount(form, asFetch(reply(500, {})))).toBe("failed");
    expect(await signInAccount(form, asFetch(vi.fn(async () => { throw new TypeError("offline"); })))).toBe("offline");
    expect(getAccount()).toBeNull();
  });

  it("forgets a session the server no longer knows, and keeps it when offline", async () => {
    await signInAccount({ email: "laura@ejemplo.com", password: "clave-segura" }, asFetch(reply(200, { token: "tok", account: laura })));
    await refreshAccount(asFetch(vi.fn(async () => { throw new TypeError("offline"); })));
    expect(getAccount()).toEqual(laura);
    await refreshAccount(asFetch(reply(200, { ...laura, plus_active: true, plus_until: "2026-12-03T00:00:00+00:00" })));
    expect(getAccount()?.plus_active).toBe(true);
    await refreshAccount(asFetch(reply(401, { detail: "signed_out" })));
    expect(getAccount()).toBeNull();
  });
});
