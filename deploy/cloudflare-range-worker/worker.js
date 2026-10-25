// Hands ViKiNG one byte range of a TorBox file as if it were a whole file.
//
// ViKiNG's remote upload downloads a link with a plain GET, and TorBox links always serve the whole file.
// The GameAccess server signs a link to this Worker for each piece (TorBox link, first and last byte,
// expiry); the Worker asks TorBox for that range and streams it through untouched. No byte goes through
// the GameAccess server, and the Worker only pipes the body (it never reads it).
//
// Only signed requests for TorBox hosts are served, so the Worker is not an open proxy.
// Secret: RANGE_SECRET (wrangler secret put RANGE_SECRET), the same value as GAMEACCESS_RANGE_SECRET on the server.

const ALLOWED_HOSTS = [/\.tb-cdn\.cx$/i, /(^|\.)torbox\.app$/i];

function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return atob(padded);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/piece") return new Response("not found", { status: 404 });
    const encoded = url.searchParams.get("u") || "";
    const start = Number(url.searchParams.get("s"));
    const end = Number(url.searchParams.get("e"));
    const expires = Number(url.searchParams.get("x"));
    const signature = url.searchParams.get("sig") || "";
    if (!env.RANGE_SECRET || !encoded || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      return new Response("bad request", { status: 400 });
    }
    if (!Number.isSafeInteger(expires) || expires * 1000 < Date.now()) return new Response("expired", { status: 403 });
    const expected = await sign(env.RANGE_SECRET, `${encoded}|${start}|${end}|${expires}`);
    if (!equal(expected, signature)) return new Response("forbidden", { status: 403 });

    let source;
    try {
      source = new URL(fromBase64Url(encoded));
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (source.protocol !== "https:" || !ALLOWED_HOSTS.some((host) => host.test(source.hostname))) {
      return new Response("forbidden", { status: 403 });
    }

    const upstream = await fetch(source.toString(), { headers: { Range: `bytes=${start}-${end}` }, redirect: "follow" });
    const size = end - start + 1;
    const range = upstream.headers.get("content-range") || "";
    if (upstream.status !== 206 || !range.toLowerCase().startsWith(`bytes ${start}-${end}/`)) {
      return new Response(`upstream ${upstream.status}`, { status: 502 });
    }
    const name = (url.searchParams.get("n") || "piece.bin").replace(/[^\w.-]/g, "_");
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  },
};
