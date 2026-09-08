import { describe, expect, it } from "vitest";

import { normalizeApiBaseUrl, resolveApiFromSettings } from "./settings";

const response = (body: string, init?: ResponseInit) => Promise.resolve(new Response(body, init));

describe("frontend backend settings", () => {
  it("uses a direct configured backend and removes the trailing slash", async () => {
    await expect(resolveApiFromSettings({ api_url: "https://api.example.com/" })).resolves.toBe("https://api.example.com");
  });

  it("resolves a stable JSON pointer to a changing backend", async () => {
    const fetcher = () => response(JSON.stringify({ api_url: "https://gameaccess-live.onrender.com/" }), { status: 200 });
    await expect(resolveApiFromSettings({ api_url: "", api_url_resolver: "https://example.github.io/backend.json" }, fetcher)).resolves.toBe("https://gameaccess-live.onrender.com");
  });

  it("understands a static HTML meta-refresh pointer", async () => {
    const html = '<html><head><meta http-equiv="refresh" content="0; url=https://next-backend.onrender.com/"></head></html>';
    const fetcher = () => response(html, { status: 200, headers: { "content-type": "text/html" } });
    await expect(resolveApiFromSettings({ api_url_resolver: "https://example.github.io/backend.html" }, fetcher)).resolves.toBe("https://next-backend.onrender.com");
  });

  it("accepts HTTPS remotely but rejects insecure non-loopback HTTP", () => {
    expect(normalizeApiBaseUrl("https://api.example.com")).toBe("https://api.example.com");
    expect(normalizeApiBaseUrl("http://127.0.0.1:38147")).toBe("http://127.0.0.1:38147");
    expect(normalizeApiBaseUrl("http://api.example.com")).toBeNull();
  });

  it("stays offline when an explicitly configured pointer cannot be resolved", async () => {
    const fetcher = () => response("no backend", { status: 503 });
    await expect(resolveApiFromSettings({ api_url: "", api_url_resolver: "https://example.github.io/backend.json" }, fetcher)).resolves.toBe("");
  });
});
