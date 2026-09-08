import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_API,
  normalizeApiBaseUrl,
  resolveApiFromSettings,
  resolveBackendConnectionFromSettings,
} from "./settings";

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
    expect(normalizeApiBaseUrl(DEFAULT_LOCAL_API)).toBe(DEFAULT_LOCAL_API);
    expect(normalizeApiBaseUrl("http://api.example.com")).toBeNull();
  });

  it("stays offline when an explicitly configured pointer cannot be resolved", async () => {
    const fetcher = () => response("no backend", { status: 503 });
    await expect(resolveApiFromSettings({ api_url: "", api_url_resolver: "https://example.github.io/backend.json" }, fetcher)).resolves.toBe("");
  });

  it("always prefers a healthy local development server over the configured remote backend", async () => {
    const fetcher = (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${DEFAULT_LOCAL_API}/health`) return response('{"ok":true}', { status: 200 });
      throw new Error(`remote backend should not be contacted while local is healthy: ${url}`);
    };
    await expect(resolveBackendConnectionFromSettings({ api_url: "https://remote.example.com" }, fetcher)).resolves.toEqual({
      kind: "local",
      url: DEFAULT_LOCAL_API,
    });
  });

  it("falls back to the configured remote backend when local is unavailable", async () => {
    const fetcher = (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${DEFAULT_LOCAL_API}/health`) return response("offline", { status: 503 });
      if (url === "https://remote.example.com/health") return response('{"ok":true}', { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    };
    await expect(resolveBackendConnectionFromSettings({ api_url: "https://remote.example.com" }, fetcher)).resolves.toEqual({
      kind: "remote",
      url: "https://remote.example.com",
    });
  });

  it("reports offline without disabling the rest of the frontend when neither backend responds", async () => {
    const fetcher = () => response("offline", { status: 503 });
    await expect(resolveBackendConnectionFromSettings({ api_url: "https://remote.example.com" }, fetcher)).resolves.toEqual({
      kind: "offline",
      url: "",
    });
  });
});
