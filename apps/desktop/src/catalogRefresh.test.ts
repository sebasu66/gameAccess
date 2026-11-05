import { describe, expect, it } from "vitest";
import source from "./CatalogRefreshButton.tsx?raw";
import mainSource from "./main.tsx?raw";
import panelSource from "./DownloadCatalogPanel.tsx?raw";
import i18nSource from "./locales/es.ts?raw";


describe("GameAccess catalog refresh control", () => {
  it("exposes a visible refresh action that reloads catalog state from the backend", () => {
    expect(source).toContain('<GaIconButton className="ga-catalog-refresh"');
    expect(source).toContain('label={t("refreshGames")}');
    expect(source).toContain("captureLibraryUiState(mode);");
    expect(source).toContain("window.dispatchEvent(new Event(CATALOG_REFRESH_REQUEST))");
    expect(source).toContain("disabled={refreshing}");
    expect(panelSource).toContain('view === "catalog" ? <CatalogRefreshButton />');
    expect(mainSource).not.toContain("refreshGames");
    expect(i18nSource).toContain('refreshGamesAria: "Actualizar lista de juegos"');
  });

});
