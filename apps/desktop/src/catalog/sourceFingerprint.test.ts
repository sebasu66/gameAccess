import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sourceFingerprint, sourceIdentity } from "./sourceFingerprint";

// Same values as GOLDEN in apps/api/tests/test_source_lessons.py: the server computes these fingerprints too.
const GOLDEN: Record<string, string> = {
  "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Game+v1&tr=udp://t.example:80":
    "torrent:urn:btih:abcdef0123456789abcdef0123456789abcdef01",
  "https://Files.Example.com:443/d/Game%20v1.zip?b=2&a=1&token=secret#part":
    "direct:https://files.example.com/d/Game%20v1.zip?a=1&b=2",
  "http://example.com:8080?q=a+b&x=%21":
    "direct:http://example.com:8080/?q=a+b&x=%21",
};

describe("source fingerprint", () => {
  it("is the server's fingerprint for the same source", async () => {
    for (const [url, identity] of Object.entries(GOLDEN)) {
      expect(sourceIdentity(url)).toBe(identity);
      expect(await sourceFingerprint(url)).toBe(createHash("sha256").update(identity).digest("hex"));
    }
  });

  it("does not change with trackers, names or expiring tokens", async () => {
    const hash = "0123456789abcdef0123456789abcdef01234567";
    expect(await sourceFingerprint(`magnet:?xt=urn:btih:${hash}&tr=udp://a`))
      .toBe(await sourceFingerprint(`magnet:?dn=Other&xt=urn:btih:${hash.toUpperCase()}`));
    expect(await sourceFingerprint("https://h.example/f.zip?expires=1&sig=x"))
      .toBe(await sourceFingerprint("https://h.example/f.zip"));
  });

  it("has none for what is not a magnet or an HTTP(S) link", async () => {
    expect(await sourceFingerprint("ftp://h.example/f.zip")).toBeNull();
    expect(await sourceFingerprint("magnet:?dn=no-hash")).toBeNull();
    expect(await sourceFingerprint("https://user:pw@h.example/f")).toBeNull();
    expect(await sourceFingerprint("")).toBeNull();
  });
});
