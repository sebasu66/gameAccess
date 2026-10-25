import { describe, expect, it } from "vitest";
import { translate } from "./i18n";

import appSource from "./App.tsx?raw";
import buildSource from "./BuildStamp.tsx?raw";
import backendSource from "./BackendStatus.tsx?raw";
import tabsSource from "./CatalogTabs.tsx?raw";
import completionSource from "./LibraryRoom.tsx?raw";
import storageSource from "./gameStorage.ts?raw";
import libraryDetailSource from "./LibraryDetailPanel.tsx?raw";
import steamSettingsSource from "./AppSettings.tsx?raw";

describe("Spanish desktop UI copy", () => {
  it("keeps primary labels and user-facing messages in Spanish", () => {
    expect(tabsSource).not.toContain('label: "Tienda"');
    expect(tabsSource).not.toContain('label: "Store"');
    expect(backendSource).toContain("Local");
    expect(backendSource).toContain("Desconectado");
    expect(buildSource).toContain("Compilaci\u00f3n:");
    expect(buildSource).not.toContain("Server:");
    expect(buildSource).not.toContain("Compilation time");
    expect(libraryDetailSource).not.toContain(">Publisher<");
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
    expect(completionSource).toContain('translate("dlsReady")');
    expect(translate("dlsReady", undefined, "es")).toBe("Listo para jugar");
    expect(completionSource).not.toContain("Los archivos ya est\u00e1n preparados");
  });
});
