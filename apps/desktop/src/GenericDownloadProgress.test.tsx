import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  getDownloadStatusLabel,
  getGenericProgress,
  GenericDownloadProgressView,
} from "./GenericDownloadProgress";
import type { GenericDownloadStatus } from "./downloadTypes";

describe("GenericDownloadProgress", () => {
  it("calculates progress percentage accurately", () => {
    expect(getGenericProgress(null)).toBe(0);
    expect(getGenericProgress({ state: "installed" })).toBe(100);
    expect(getGenericProgress({ bytes_downloaded: 50, bytes_total: 100 })).toBe(50);
    expect(getGenericProgress({ progress: 75.4 })).toBe(75.4);
  });

  it("formats status labels across download and decompression phases", () => {
    expect(getDownloadStatusLabel({ state: "preparing" })).toMatch(/Preparando|Preparing/);
    expect(getDownloadStatusLabel({ state: "downloading", progress: 42 })).toMatch(/(Descargando|Downloading) 42%/);
    expect(getDownloadStatusLabel({ state: "decompressing", progress: 85 })).toMatch(/(Descomprimiendo|Decompressing) 85%/);
    expect(getDownloadStatusLabel({ state: "installing", progress: 99 })).toMatch(/(Instalando|Installing) 99%/);
    expect(getDownloadStatusLabel({ state: "paused" })).toMatch(/Pausado|Paused/);
    expect(getDownloadStatusLabel({ statusText: "Extrayendo paquete 2/4" })).toBe("Extrayendo paquete 2/4");
  });

  it("formats metrics cleanly", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(10737418240)).toBe("10 GB");
    expect(formatSpeed(5242880)).toBe("5.0 MB/s");
    expect(formatEta(120)).toBe("2 min");
    expect(formatEta(3665)).toBe("1 h 1 min");
  });

  it("renders generic progress view markup with status and progressbar", () => {
    const status: GenericDownloadStatus = {
      state: "decompressing",
      progress: 65,
      bytes_downloaded: 650000000,
      bytes_total: 1000000000,
      speed_bps: 10000000,
      eta_seconds: 35,
    };
    const markup = renderToStaticMarkup(<GenericDownloadProgressView download={status} />);
    expect(markup).toMatch(/(Decompressing|Descomprimiendo) 65%/);
    expect(markup).toContain("65%");
    expect(markup).toContain("style=\"width:65%\"");
  });
});
