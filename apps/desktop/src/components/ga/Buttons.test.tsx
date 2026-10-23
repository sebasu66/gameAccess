// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { GaBack, GaButton, GaClose, GaIconButton } from "./Buttons";

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(node));
  return host;
}

describe("shared buttons", () => {
  it("renders the action variants with their class and a default type", () => {
    const host = render(<><GaButton variant="primary">Jugar</GaButton><GaButton variant="danger" size="tall">Borrar</GaButton></>);
    const [primary, danger] = host.querySelectorAll("button");
    expect(primary.className).toBe("ga-btn-primary");
    expect(primary.type).toBe("button");
    expect(danger.className).toBe("ga-btn-danger ga-btn-tall");
  });

  it("gives the cube its label, pressed state and a hidden-at-zero badge", () => {
    const host = render(<><GaIconButton icon={<i />} label="Descargas" pressed badge={3} /><GaIconButton icon={<i />} label="Novedades" badge={0} /></>);
    const [downloads, news] = host.querySelectorAll("button");
    expect(downloads.getAttribute("aria-label")).toBe("Descargas");
    expect(downloads.getAttribute("aria-pressed")).toBe("true");
    expect(downloads.querySelector(".ga-cube-badge")?.textContent).toBe("3");
    expect(news.querySelector(".ga-cube-badge")).toBeNull();
  });

  it("close and back call their handler and carry the translated label", () => {
    const onClose = vi.fn(), onBack = vi.fn();
    const host = render(<><GaClose label="Cerrar" onClick={onClose} /><GaBack label="Volver" onClick={onBack} /></>);
    const [close, back] = host.querySelectorAll("button");
    expect(close.getAttribute("aria-label")).toBe("Cerrar");
    expect(back.textContent).toBe("Volver");
    act(() => { close.click(); back.click(); });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
