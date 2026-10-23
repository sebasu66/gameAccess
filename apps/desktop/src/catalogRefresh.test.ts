import { describe, expect, it } from "vitest";
import source from "./main.tsx?raw";
import i18nSource from "./locales/es.ts?raw";


describe("GameAccess catalog refresh control", () => {
  it("exposes a visible refresh action that reloads catalog state from the backend", () => {
    expect(source).toContain('<GaIconButton className="catalog-refresh-button"');
    expect(source).toContain('label={t("refreshGames")}');
    expect(source).toContain("if (!auxiliarySurface) captureLibraryUiState(mode);");
    expect(source).toContain("window.dispatchEvent(new Event(CATALOG_REFRESH_REQUEST))");
    expect(source).toContain("disabled={refreshing}");
    expect(i18nSource).toContain('refreshGamesAria: "Actualizar lista de juegos"');
    expect(source).not.toContain("setRefreshNonce((value) => value + 1)");
  });

  it("keeps the refresh control off auxiliary tablet/display surfaces", () => {
    expect(source).toContain('!auxiliarySurface ? <div className="catalog-bottom-actions"');
    expect(source).toContain('<GaIconButton className="catalog-refresh-button"');
  });
});
