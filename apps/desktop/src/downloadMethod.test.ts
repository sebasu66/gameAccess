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

  it("names the route without naming the services behind the acceleration", () => {
    expect(downloadMethodLabel("torrent", "es").label).toBe("Torrent directo");
    expect(downloadMethodLabel("accelerated", "en").label).toBe("Accelerated");
    expect(downloadMethodLabel("accelerated", "es").hint).toContain("servicio de aceleración de torrents");
    for (const method of ["measuring", "torrent", "accelerated", "direct"] as const) {
      for (const locale of ["es", "en"]) expect(JSON.stringify(downloadMethodLabel(method, locale))).not.toMatch(/torbox|viking/i);
    }
  });

  it("names the plan", () => {
    expect(planLabel("plus", "es").label).toBe("PLUS");
    expect(planLabel("base", "en").label).toBe("BASE");
  });
});
