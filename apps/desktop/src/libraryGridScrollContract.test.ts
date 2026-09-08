import { describe, expect, it } from "vitest";
import libraryRoomSource from "./LibraryRoom.tsx?raw";

describe("desktop library keyboard autoscroll contract", () => {
  it("keeps desktop keyboard selection visible without Godot surface branches", () => {
    expect(libraryRoomSource).toContain("if (selectedIndex < 0) return;");
    expect(libraryRoomSource).toContain("selectionItemTopInScrollContainer");
    expect(libraryRoomSource).toContain("getBoundingClientRect()");
    expect(libraryRoomSource).not.toContain("isTabletSurface");
    expect(libraryRoomSource).not.toContain("sendIpcMessage");
    expect(libraryRoomSource).not.toContain("isDisplaySurface");
  });
});
