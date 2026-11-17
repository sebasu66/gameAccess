/**
 * A download source's fingerprint: the same SHA-256 the Game Access server computes in
 * apps/api/app/viking_cache_service.py `normalize_source_url`, so the app can tell the server about a source (and ask
 * about one) without ever sending its address. A magnet is its torrent's info-hash(es), whatever trackers or names
 * it carries; a direct link is its scheme, host, port, path and stable query (expiring tokens and signatures left
 * out). Both sides check the same golden values (tests/test_source_lessons.py, sourceFingerprint.test.ts).
 */

// Query keys that change on every request (signed links) and do not name another file.
const TRANSIENT_QUERY_KEYS = /^(?:token|access_token|signature|sig|expires|expiry|authorization|auth|policy|jwt|download_token|x-amz-.+|x-goog-.+|x-ms-.+|se|sp|sv|sr|st|skoid|sktid|skt|ske|sks|skv)$/i;

/** Python's `unquote_plus`. */
function unquotePlus(value: string): string {
  const spaced = value.replace(/\+/g, " ");
  try { return decodeURIComponent(spaced); } catch { return spaced; }
}

/** Python's `quote_plus`: letters, digits and `_.-~` stay; a space becomes `+`. */
function quotePlus(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");
}

/** The text that is hashed, or null when the address is not a magnet or an HTTP(S) link. */
export function sourceIdentity(url: string): string | null {
  const value = String(url || "").trim();
  if (!value || value.length > 8192) return null;
  if (/^magnet:\?/i.test(value)) {
    const query = value.slice(value.indexOf("?") + 1).split("#")[0];
    const topics = new Set<string>();
    for (const part of query.split("&")) {
      const [key, ...rest] = part.split("=");
      if (unquotePlus(key) !== "xt") continue;
      const topic = unquotePlus(rest.join("=")).trim().toLowerCase();
      if (topic.startsWith("urn:btih:") || topic.startsWith("urn:btmh:")) topics.add(topic);
    }
    return topics.size ? "torrent:" + [...topics].sort().join("|") : null;
  }
  const found = value.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i);
  if (!found) return null;
  const scheme = found[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https" || found[2].includes("@")) return null;
  let host: string;
  let port: string;
  try {
    const parsed = new URL(`${scheme}://${found[2]}/`);
    host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    // The URL parser already drops a default port (http 80, https 443), as the server does.
    port = parsed.port;
  } catch { return null; }
  if (!host) return null;
  const hostForUrl = host.includes(":") ? `[${host}]` : host;
  const stable = (found[4] ?? "").split("&").filter(Boolean)
    .map(part => { const at = part.indexOf("="); return at < 0 ? [unquotePlus(part), ""] : [unquotePlus(part.slice(0, at)), unquotePlus(part.slice(at + 1))]; })
    .filter(([key]) => !TRANSIENT_QUERY_KEYS.test(key))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([key, item]) => `${quotePlus(key)}=${quotePlus(item)}`).join("&");
  return `direct:${scheme}://${hostForUrl}${port ? ":" + port : ""}${found[3] || "/"}${stable ? "?" + stable : ""}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const known = new Map<string, Promise<string | null>>();

/** The source's fingerprint, or null for an address the server would not take either. */
export function sourceFingerprint(url: string): Promise<string | null> {
  const identity = sourceIdentity(url);
  if (!identity) return Promise.resolve(null);
  let pending = known.get(identity);
  if (!pending) {
    pending = sha256Hex(identity).catch(() => null);
    known.set(identity, pending);
  }
  return pending;
}
