import { describe, expect, it } from "vitest";
import libraryRoomSource from "./LibraryRoom.tsx?raw";
import shelfSource from "./LibrarySectionShelf.tsx?raw";

describe("desktop library keyboard autoscroll contract", () => {
  it("keeps desktop keyboard selection visible without Godot surface branches", () => {
    expect(libraryRoomSource).not.toContain("calculateSelectionScrollTop");
    expect(shelfSource).toContain("selectionItemTopInScrollContainer");
    expect(shelfSource).toContain("getBoundingClientRect()");
    expect(libraryRoomSource).not.toContain("isTabletSurface");
    expect(libraryRoomSource).not.toContain("sendIpcMessage");
    expect(libraryRoomSource).not.toContain("isDisplaySurface");
  });
});
