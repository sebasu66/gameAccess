import { describe, expect, it } from "vitest";
import { readActiveDownloads } from "../downloads/useActiveDownloadCount";
import { diskFreePercent, formatSpeed, formatSyncTime } from "./statusBarData";

describe("barra de estado (Rediseño de navegación §4.5)", () => {
  it("el disco dice qué parte queda libre, y nada hasta leer la biblioteca", () => {
    expect(diskFreePercent({ disk_free_bytes: 610, disk_total_bytes: 1000 })).toBe(61);
    expect(diskFreePercent({ disk_free_bytes: 5, disk_total_bytes: 0 })).toBeNull();
    expect(diskFreePercent(null)).toBeNull();
  });

  it("las descargas suman su velocidad y no cuentan las terminadas", () => {
    const entries = [
      { snapshot: { phase: "downloading" as const, speedBps: 8 * 1024 * 1024 } },
      { snapshot: { phase: "paused" as const } },
      { snapshot: { phase: "completed" as const, speedBps: 999 } },
    ];
    expect(readActiveDownloads(entries)).toEqual({ count: 2, speedBps: 8 * 1024 * 1024 });
    expect(formatSpeed(12.4 * 1024 * 1024, "es")).toBe("12,4 MB/s");
    expect(formatSpeed(0, "en")).toBe("0 B/s");
  });

  it("la hora del catálogo lleva el día solo si no es de hoy", () => {
    const now = new Date(2026, 10, 11, 15, 0).getTime();
    expect(formatSyncTime(new Date(2026, 10, 11, 11, 2).getTime(), now, "es")).toBe("11:02");
    expect(formatSyncTime(new Date(2026, 10, 9, 11, 2).getTime(), now, "es")).toMatch(/^9 nov\.? 11:02$/);
  });
});
