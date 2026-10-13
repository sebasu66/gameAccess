import { afterEach, describe, expect, it, vi } from "vitest";

const narrate = vi.fn(async () => undefined);
vi.mock("./narrationLog", () => ({ narrate }));
vi.mock("./settings", () => ({ getApiBaseUrl: async () => "http://api.test" }));
vi.mock("./activation", () => ({ readActivationSession: async () => "token", getInstallationId: async () => "install" }));

const { canAccelerate, resolveVikingDownload } = await import("./vikingResolver");
const messages = () => narrate.mock.calls.map(call => String(call[0]));

afterEach(() => { narrate.mockClear(); vi.unstubAllGlobals(); });

describe("vikingResolver", () => {
  it("accepts direct links and magnets only", () => {
    expect(canAccelerate("https://host/file.zip")).toBe(true);
    expect(canAccelerate("magnet:?xt=urn:btih:abc")).toBe(true);
    expect(canAccelerate("auto")).toBe(false);
  });

  it("logs the request and the processed link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, url: "https://vikingfile.com/f/abc", name: "g.zip", size_bytes: 5, cache_hit: false }))));
    const result = await resolveVikingDownload({ sourceUrl: "https://host/file.zip", itemName: "Game" });
    expect(result?.url).toBe("https://vikingfile.com/f/abc");
    expect(messages()[0]).toBe("Enviando petición de descarga al server para el link https://host/file.zip");
    expect(messages()[1]).toBe("Recibido link de descarga procesado: https://vikingfile.com/f/abc");
  });

  it("shows the server's reason and returns null on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "La aceleración requiere el plan PLUS." }), { status: 403 })));
    expect(await resolveVikingDownload({ sourceUrl: "https://host/file.zip" })).toBeNull();
    expect(messages().some(m => m.includes("La aceleración requiere el plan PLUS."))).toBe(true);
    expect(narrate.mock.calls.at(-1)?.[1]).toMatchObject({ level: "ERROR" });
  });

  it("reports a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("sin conexión"); }));
    expect(await resolveVikingDownload({ sourceUrl: "magnet:?xt=urn:btih:abc" })).toBeNull();
    expect(messages().at(-1)).toContain("sin conexión");
  });
});
