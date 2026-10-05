import { describe, expect, it } from "vitest";
import source from "./main.tsx?raw";


describe("GameAccess catalog refresh control", () => {
  it("exposes a visible refresh action that reloads catalog state from the backend", () => {
    expect(source).toContain('aria-label="Actualizar lista de juegos"');
    expect(source).toContain("captureLibraryUiState(mode)");
    expect(source).toContain("window.location.reload()");
    expect(source).not.toContain("setRefreshNonce((value) => value + 1)");
  });

  it("keeps the refresh control off auxiliary tablet/display surfaces", () => {
    expect(source).toContain("!auxiliarySurface ? <button");
  });
});
