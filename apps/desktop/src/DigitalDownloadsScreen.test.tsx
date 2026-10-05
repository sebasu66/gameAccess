import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DigitalDownloadsScreen, { formatDownloadBytes } from "./DigitalDownloadsScreen";
import { DigitalDownloadService } from "./catalog/DigitalDownloadService";
vi.mock("./narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
describe("Digital download screen", () => {
  it("shows an actionable empty state", () => {
    const html = renderToStaticMarkup(<DigitalDownloadsScreen service={new DigitalDownloadService()} onClose={() => {}} />);
    expect(html).toContain("No hay descargas");
    expect(html).toContain("Explorar catálogo");
    expect(html).toContain("Cerrar descargas y volver a la pantalla principal");
    expect(html).not.toContain("NaN");
  });
  it("offers abort and retry for a failed download", () => {
    const service = new DigitalDownloadService();
    service.recordFailure({ id: 1912410, app_id: 1912410, name: "Minecraft Dungeons II" } as import("./types").CatalogGame, "Contraseña inválida");
    const html = renderToStaticMarkup(<DigitalDownloadsScreen service={service} onClose={() => {}} />);
    expect(html).toContain("Abortar descarga de Minecraft Dungeons II");
    expect(html).toContain(">Abortar</button>");
    expect(html).toContain("Reintentar");
    expect(html).toContain("Cerrar descargas y volver a la pantalla principal");
  });
  it("formats missing and invalid metrics without invented values", () => {
    expect(formatDownloadBytes(undefined)).toBe("—");
    expect(formatDownloadBytes(NaN)).toBe("—");
    expect(formatDownloadBytes(1024)).toBe("1 KB");
    expect(formatDownloadBytes(-1)).toBe("0 B");
  });
});
