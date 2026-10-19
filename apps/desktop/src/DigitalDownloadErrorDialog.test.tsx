import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadProblemDialog, NotAGameDialog, type DownloadProblem } from "./DigitalDownloadErrorDialog";
import {translate} from "./i18n";
const problem: DownloadProblem = { key: "fixture", name: "Minecraft Dungeons II", error: "Ninguna contraseña del servidor funcionó.", reportMessage: "fixture", reported: true };
describe("Digital download failure dialog", () => {
  it("identifies the game, displays the error and confirms acknowledged support reports", () => {
    const html = renderToStaticMarkup(<DownloadProblemDialog problem={problem} onClose={() => {}} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(translate("downloadProblemTitle",{name:problem.name}));
    expect(html).toContain(problem.error);
    expect(html).toContain(translate("downloadSupportSent"));
    expect(html).toContain(translate("downloadSupportSorry"));
  });
  it("explains a download that is not a game and points to another source, without retry or repair", () => {
    const html = renderToStaticMarkup(<NotAGameDialog problem={{ ...problem, notAGame: ["audio", "images"] }} onClose={() => {}} />);
    expect(html).toContain(translate("notAGameTitle", { name: problem.name }));
    expect(html).toContain(translate("notAGameKindAudio"));
    expect(html).toContain(translate("notAGameKindImages"));
    expect(html).not.toContain(translate("downloadSupportSent"));
  });
  it("does not claim delivery when the server rejected the report", () => {
    const html = renderToStaticMarkup(<DownloadProblemDialog problem={{ ...problem, reported: false }} onClose={() => {}} />);
    expect(html).toContain(translate("downloadSupportFailed"));
    expect(html).not.toContain(translate("downloadSupportSent"));
  });
});
