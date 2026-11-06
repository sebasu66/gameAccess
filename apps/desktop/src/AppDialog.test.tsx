import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AppDialog from "./AppDialog";

const base = { title: "¿Desinstalar Magicka?", message: "Se borrarán los archivos.", tone: "warning" as const, onClose: () => {}, onConfirm: () => {} };

describe("AppDialog", () => {
  it("asks first with a cancel and a confirm button", () => {
    const html = renderToStaticMarkup(<AppDialog {...base} confirmLabel="Desinstalar" />);
    expect(html).toContain("Se borrarán los archivos.");
    expect(html).toContain("Desinstalar");
    expect(html).toContain("ga-dialog-secondary");
  });
  it("shows the running step in the same dialog and hides the buttons while it works", () => {
    const html = renderToStaticMarkup(<AppDialog {...base} progress={{ phase: "working", label: "Borrando carpeta…", detail: "Magicka" }} />);
    expect(html).toContain("Borrando carpeta…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("<button");
  });
  it("confirms the result and offers a single close button", () => {
    const html = renderToStaticMarkup(<AppDialog {...base} progress={{ phase: "done", label: "Carpeta borrada.", detail: "C:\\Games\\Magicka" }} />);
    expect(html).toContain("Carpeta borrada.");
    expect(html).toContain("C:\\Games\\Magicka");
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
