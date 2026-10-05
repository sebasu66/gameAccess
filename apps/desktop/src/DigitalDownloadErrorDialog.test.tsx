import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadProblemDialog, type DownloadProblem } from "./DigitalDownloadErrorDialog";
const problem: DownloadProblem = { key: "fixture", name: "Minecraft Dungeons II", error: "Ninguna contraseña del servidor funcionó.", reportMessage: "fixture", reported: true };
describe("Digital download failure dialog", () => {
  it("identifies the game, displays the error and confirms acknowledged support reports", () => {
    const html = renderToStaticMarkup(<DownloadProblemDialog problem={problem} onClose={() => {}} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Hubo un problema con Minecraft Dungeons II");
    expect(html).toContain(problem.error);
    expect(html).toContain("Ya hemos enviado los detalles a nuestro soporte.");
    expect(html).toContain("Disculpe las molestias.");
  });
  it("does not claim delivery when the server rejected the report", () => {
    const html = renderToStaticMarkup(<DownloadProblemDialog problem={{ ...problem, reported: false }} onClose={() => {}} />);
    expect(html).toContain("No pudimos enviar los detalles");
    expect(html).not.toContain("Ya hemos enviado");
  });
});
