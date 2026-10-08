import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadProblemDialog, type DownloadProblem } from "./DigitalDownloadErrorDialog";
import {translate} from "./i18n";
const problem: DownloadProblem = { key: "fixture", name: "Minecraft Dungeons II", error: "Ninguna contraseña del servidor funcionó.", reportMessage: "fixture", reported: true };
describe("Digital download failure dialog", () => {
  it("identifies the game, displays the error and confirms acknowledged support reports", () => {
    const html = renderToStaticMarkup(<DownloadProblemDialog problem={problem} onClose={() => {}} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(translate("downloadProblemTitle",{name:problem.name},"en"));
    expect(html).toContain(problem.error);
    expect(html).toContain(translate("downloadSupportSent",undefined,"en"));
    expect(html).toContain(translate("downloadSupportSorry",undefined,"en"));
  });
  it("does not claim delivery when the server rejected the report", () => {
    const html = renderToStaticMarkup(<DownloadProblemDialog problem={{ ...problem, reported: false }} onClose={() => {}} />);
    expect(html).toContain(translate("downloadSupportFailed",undefined,"en"));
    expect(html).not.toContain(translate("downloadSupportSent",undefined,"en"));
  });
});
