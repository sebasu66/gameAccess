import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DigitalDownloadsScreen, { formatDownloadBytes } from "./DigitalDownloadsScreen";
import { DigitalDownloadService } from "./catalog/DigitalDownloadService";
describe("Digital download screen", () => {
  it("shows an actionable empty state", () => {
    const html = renderToStaticMarkup(<DigitalDownloadsScreen service={new DigitalDownloadService()} onClose={() => {}} />);
    expect(html).toContain("No hay descargas");
    expect(html).toContain("Explorar catálogo");
    expect(html).not.toContain("NaN");
  });
  it("formats missing and invalid metrics without invented values", () => {
    expect(formatDownloadBytes(undefined)).toBe("—");
    expect(formatDownloadBytes(NaN)).toBe("—");
    expect(formatDownloadBytes(1024)).toBe("1 KB");
    expect(formatDownloadBytes(-1)).toBe("0 B");
  });
});
