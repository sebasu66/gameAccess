import { describe, expect, it } from "vitest";
import libraryRoomSource from "./LibraryRoom.tsx?raw";

describe("desktop library keyboard autoscroll contract", () => {
  it("keeps desktop and tablet keyboard selection visible without affecting display mode", () => {
    expect(libraryRoomSource).toContain("if (selectedIndex < 0 || isDisplaySurface) return;");
    expect(libraryRoomSource).toContain("selectionItemTopInScrollContainer");
    expect(libraryRoomSource).toContain("getBoundingClientRect()");
    expect(libraryRoomSource).not.toContain("if (!isTabletSurface || selectedIndex < 0) return;");
  });
});
