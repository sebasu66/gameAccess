import { describe, expect, it } from "vitest";
import { downloadMethodLabel, initialDownloadMethod, methodFromRoute, planLabel } from "./downloadMethod";

describe("download method pill", () => {
  it("guesses from the source and the plan until the launcher reports", () => {
    expect(initialDownloadMethod("magnet:?xt=urn:btih:abc", false)).toBe("torrent");
    expect(initialDownloadMethod("magnet:?xt=urn:btih:abc", true)).toBe("measuring");
    expect(initialDownloadMethod("https://host/file.torrent?x=1", false)).toBe("torrent");
    expect(initialDownloadMethod("https://host/file.zip", false)).toBe("direct");
    expect(initialDownloadMethod("https://host/file.zip", true)).toBe("accelerated");
  });

  it("follows the route the launcher reports", () => {
    expect(methodFromRoute("torrent")).toBe("torrent");
    expect(methodFromRoute("accelerated")).toBe("accelerated");
    expect(methodFromRoute("")).toBeUndefined();
    expect(methodFromRoute(undefined)).toBeUndefined();
  });

  it("only says Viking when the server accelerates it", () => {
    expect(downloadMethodLabel("torrent", "es").label).toBe("Torrent directo");
    expect(downloadMethodLabel("accelerated", "es").label).toContain("Viking");
    expect(downloadMethodLabel("torrent", "en").label).not.toContain("Viking");
  });

  it("names the plan", () => {
    expect(planLabel("plus", "es").label).toBe("PLUS");
    expect(planLabel("base", "en").label).toBe("BASE");
  });
});
