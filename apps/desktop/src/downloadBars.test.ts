import { describe, expect, it } from "vitest";
import { downloadBars } from "./downloadBars";

describe("downloadBars", () => {
  it("keeps download and installation separate", () => {
    expect(downloadBars({ phase: "downloading", progress: 25, downloadPercent: 50, installPercent: 0 })).toEqual({ download: 50, install: 0 });
    expect(downloadBars({ phase: "decompressing", progress: 75, downloadPercent: 100, installPercent: 40 })).toEqual({ download: 100, install: 40 });
  });

  it("a finished download is not a finished installation", () => {
    const bars = downloadBars({ phase: "decompressing", progress: 50, downloadPercent: 100, installPercent: 0 });
    expect(bars).toEqual({ download: 100, install: 0 });
  });

  it("completed fills both bars", () => {
    expect(downloadBars({ phase: "completed", progress: 100 })).toEqual({ download: 100, install: 100 });
  });

  it("converts the old combined scale when the launcher sends no separate values", () => {
    expect(downloadBars({ phase: "downloading", progress: 25 })).toEqual({ download: 50, install: 0 });
    expect(downloadBars({ phase: "decompressing", progress: 75 })).toEqual({ download: 100, install: 50 });
    expect(downloadBars({ phase: "preparing", progress: 0 })).toEqual({ download: 0, install: 0 });
  });

  it("clamps out-of-range values", () => {
    expect(downloadBars({ phase: "downloading", progress: 0, downloadPercent: 140, installPercent: -3 })).toEqual({ download: 100, install: 0 });
  });
});
