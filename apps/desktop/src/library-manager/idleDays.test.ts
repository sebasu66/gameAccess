import { describe, expect, it } from "vitest";
import { idleDays } from "./GameLibraryManager";

describe("idleDays", () => {
  const now = new Date("2026-10-26T12:00:00").getTime();
  it("counts whole days since the last play", () => {
    expect(idleDays({ last_played: "2026-10-20 09:00:00", added_at: "2026-01-01 00:00:00" }, now)).toBe(6);
  });
  it("counts from when the game came into the library when it was never played", () => {
    expect(idleDays({ last_played: "", added_at: "2026-10-16 12:00:00" }, now)).toBe(10);
  });
  it("has no count without either date", () => {
    expect(idleDays({ last_played: "", added_at: "" }, now)).toBeNull();
  });
});
