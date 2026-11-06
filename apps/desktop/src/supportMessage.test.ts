import { describe, expect, it, vi } from "vitest";

vi.mock("./activation", () => ({ getInstallationId: async () => "1b4e28ba-2fa1-11d2-883f-0016d3cca427" }));
vi.mock("./settings", () => ({ getApiBaseUrl: async () => "https://api.example" }));
vi.mock("./narrationLog", () => ({ narrate: async () => undefined, sanitizedRemoteError: (value: string) => value }));

import { sendSupportMessage } from "./supportMessage";

const form = { subject: " No baja ", message: "Hades en 3 %", email: "a@b.com", language: "es", attachLog: false };

describe("contact message", () => {
 it("posts the message with the installation id and no key", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  expect(await sendSupportMessage(form, fetcher as unknown as typeof fetch)).toBe("sent");
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.example/support/messages");
  expect((init.headers as Record<string, string>)["X-GameAccess-Installation"]).toBe("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
  expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  expect(JSON.parse(String(init.body))).toMatchObject({ subject: "No baja", message: "Hades en 3 %", email: "a@b.com", log: "" });
 });
 it("tells apart too many messages, a bad email and no server", async () => {
  const reply = (status: number, detail = "") => vi.fn(async () => new Response(JSON.stringify({ detail }), { status }));
  expect(await sendSupportMessage(form, reply(429) as unknown as typeof fetch)).toBe("too_many");
  expect(await sendSupportMessage(form, reply(422, "invalid_email") as unknown as typeof fetch)).toBe("invalid_email");
  expect(await sendSupportMessage(form, reply(500) as unknown as typeof fetch)).toBe("failed");
  expect(await sendSupportMessage(form, vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBe("offline");
 });
});
