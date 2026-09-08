import { describe, expect, it } from "vitest";

import roomSource from "./LibraryRoom.tsx?raw";
import partsSource from "./LibraryRoomParts.tsx?raw";

describe("Stage 2 adaptive detail visual experiment", () => {
  it("uses exact maximized-window state and a wide Steam artwork slideshow", () => {
    expect(roomSource).toContain("appWindow.isMaximized()");
    expect(roomSource).toContain("selectedWideArtworkSlides");
    expect(roomSource).toContain("setInterval");
    expect(roomSource).toContain('"is-maximized"');
  });

  it("uses portrait Steam artwork in the normal desktop layout", () => {
    expect(roomSource).toContain("selectedPortraitHero");
    expect(partsSource).toContain("library_600x900_2x.jpg");
  });

  it("keeps the title over the hero and separates the primary and preference controls", () => {
    expect(partsSource).toContain("library-room-control-row");
  });
});
