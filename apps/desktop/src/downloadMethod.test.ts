import { describe, expect, it } from "vitest";
import { downloadMethodFor, downloadMethodLabel } from "./downloadMethod";

describe("download method pill", () => {
  it("uses Viking when the server processed or cached the file", () => {
    expect(downloadMethodFor("https://vikingfile.com/f/abc", "processed")).toBe("viking");
    expect(downloadMethodFor("https://vikingfile.com/f/abc", "cache")).toBe("viking");
  });
  it("is a local torrent for magnets and .torrent files the server did not process", () => {
    expect(downloadMethodFor("magnet:?xt=urn:btih:abc", "direct")).toBe("torrent");
    expect(downloadMethodFor("magnet:?xt=urn:btih:abc")).toBe("torrent");
    expect(downloadMethodFor("https://host/file.torrent?x=1", null)).toBe("torrent");
  });
  it("is a direct download for ordinary links", () => {
    expect(downloadMethodFor("https://host/file.zip", "direct")).toBe("direct");
  });
  it("labels in both languages", () => {
    expect(downloadMethodLabel("torrent", "es").label).toBe("Torrent local");
    expect(downloadMethodLabel("viking", "en").label).toBe("Viking Files");
  });
});
