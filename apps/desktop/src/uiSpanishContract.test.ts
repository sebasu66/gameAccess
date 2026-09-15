import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";
import detailSource from "./AppDetailPanel.tsx?raw";
import buildSource from "./BuildStamp.tsx?raw";
import tabsSource from "./CatalogTabs.tsx?raw";
import completeSource from "./DownloadCompleteDialog.tsx?raw";
import storageSource from "./gameStorage.ts?raw";
import libraryDetailSource from "./LibraryDetailPanel.tsx?raw";
import steamSettingsSource from "./SteamSessionSettings.tsx?raw";

describe("Spanish desktop UI copy", () => {
  it("keeps primary labels and user-facing messages in Spanish", () => {
    expect(tabsSource).toContain('label: "Tienda"');
    expect(tabsSource).not.toContain('label: "Store"');
    expect(buildSource).toContain("Servidor: Local");
    expect(buildSource).toContain("CompilaciÃ³n:");
    expect(buildSource).not.toContain("Server:");
    expect(buildSource).not.toContain("Compilation time");
    expect(detailSource).not.toContain(">Publisher<");
    expect(libraryDetailSource).not.toContain('["Publisher"');
    expect(libraryDetailSource).not.toContain('aria-label="First row"');
    expect(libraryDetailSource).not.toContain('aria-label="Second row"');
    expect(appSource).not.toContain("Fallback Steam");
    expect(appSource).not.toContain("Visual debug session");
    expect(appSource).not.toContain("Store siguen disponibles");
    expect(storageSource).not.toContain("Freeze requiere");
    expect(storageSource).not.toContain("Restore requiere");
    expect(storageSource).not.toContain("Uninstall requiere");
    expect(steamSettingsSource).not.toContain("STEAM SESSION MANAGER");
    expect(steamSettingsSource).not.toContain("Configuraci?n");
    expect(steamSettingsSource).not.toContain("contrase?a");
    expect(completeSource).toContain("EstÃ¡ listo para jugar.");
    expect(completeSource).not.toContain("Los archivos ya estÃ¡n preparados");
  });
});
