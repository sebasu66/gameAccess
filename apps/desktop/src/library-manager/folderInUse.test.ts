import { describe, expect, it } from "vitest";
import { lockerLines } from "./folderInUse";

describe("folder in use notice", () => {
  it("names Explorer once, and each console or other program with its PID", () => {
    const lines = lockerLines([
      { pid: 10, name: "explorer.exe", kind: "explorer" },
      { pid: 20, name: "powershell.exe", kind: "console" },
      { pid: 30, name: "dirtrally2.exe", kind: "other" },
      { pid: 40, name: "", kind: "other" },
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("powershell.exe");
    expect(lines[1]).toContain("20");
    expect(lines[2]).toContain("dirtrally2.exe");
    expect(lines[3]).toContain("PID 40");
  });

  it("says nothing about programs it does not know of", () => {
    expect(lockerLines([])).toEqual([]);
  });
});
