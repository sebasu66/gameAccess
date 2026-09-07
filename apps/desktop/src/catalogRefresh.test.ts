import { describe, expect, it } from "vitest";
import source from "./main.tsx?raw";


describe("GameAccess catalog refresh control", () => {
  it("exposes a visible refresh action that remounts the catalog app", () => {
    expect(source).toContain('aria-label="Actualizar lista de juegos"');
    expect(source).toContain("setRefreshNonce((value) => value + 1)");
    expect(source).toContain('key={`${mode}:${refreshNonce}`}');
  });

  it("keeps the refresh control off auxiliary tablet/display surfaces", () => {
    expect(source).toContain("!auxiliarySurface ? <button");
  });
});
