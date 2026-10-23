import { afterEach, describe, expect, it, vi } from "vitest";

const narrate = vi.fn(async (_message: string, _options?: { level?: string; area?: string }) => undefined);
vi.mock("./narrationLog", () => ({ narrate }));
vi.mock("./settings", () => ({ getApiBaseUrl: async () => "http://api.test" }));
let tier: "base" | "plus" | null = "plus";
vi.mock("./activation", () => ({ readActivationSession: async () => "token", getInstallationId: async () => "install", getActivationTier: () => tier }));

const { canAccelerate, resolveVikingDownload, buildChunkSession } = await import("./vikingResolver");
const { isTorrentSource } = await import("./torrentSource");
const messages = () => narrate.mock.calls.map(call => String(call[0]));

afterEach(() => { narrate.mockClear(); vi.unstubAllGlobals(); tier = "plus"; });

describe("free mode", () => {
  it("never calls the server and gives no chunk session unless the key is Plus", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const value of ["base", null] as const) {
      tier = value;
      expect(await resolveVikingDownload({ sourceUrl: "magnet:?xt=urn:btih:abc" })).toBeNull();
      expect(await buildChunkSession()).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    tier = "plus";
    expect(await buildChunkSession()).toContain("install");
  });
  it("recognizes torrent sources", () => {
    expect(isTorrentSource("magnet:?xt=urn:btih:abc")).toBe(true);
    expect(isTorrentSource("https://host/a.torrent?x=1")).toBe(true);
    expect(isTorrentSource("https://host/file.zip")).toBe(false);
  });
});

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
  it("says so when the server decides the original link is better", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, url: "https://host/file.zip", name: "", size_bytes: null, cache_hit: false, mode: "direct", speed_bps: 5_000_000 }))));
    const result = await resolveVikingDownload({ sourceUrl: "https://host/file.zip" });
    expect(result?.mode).toBe("direct");
    expect(messages()[1]).toContain("conviene descargarlo directo");
    expect(messages()[1]).toContain("40 Mbps");
  });

  it("stops waiting after the time limit and says the server keeps working", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    })));
    expect(await resolveVikingDownload({ sourceUrl: "https://host/file.zip" }, 20)).toBeNull();
    const last = narrate.mock.calls[narrate.mock.calls.length - 1];
    expect(String(last[0])).toContain("El server sigue preparando el archivo");
    expect(last[1]?.level).toBe("WARN");
  });
});
