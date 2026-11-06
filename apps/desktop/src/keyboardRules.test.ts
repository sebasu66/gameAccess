// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusNewField, installKeyboardRules } from "./keyboardRules";

// jsdom lays nothing out: every element counts as shown, from left to right in the page's order.
beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [{}] as unknown as DOMRectList);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return { left: Array.from(document.querySelectorAll("*")).indexOf(this) } as DOMRect;
  });
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

const press = (key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};

describe("reglas de teclado", () => {
  it("el campo de un diálogo o una pantalla recibe el foco al aparecer, una sola vez", () => {
    document.body.innerHTML = '<section class="ga-screen"><button>Atrás</button><input id="nombre" /><input id="otro" /></section>';
    focusNewField();
    expect(document.activeElement?.id).toBe("nombre");
    (document.querySelector("button") as HTMLButtonElement).focus();
    focusNewField();
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  it("Enter pasa al campo siguiente y, después del último, al botón principal", () => {
    const stop = installKeyboardRules();
    document.body.innerHTML = '<div role="dialog" aria-modal="true"><input id="a" /><input id="b" /><button class="ga-btn-secondary">Cancelar</button><button class="ga-btn-primary">Aceptar</button></div>';
    (document.getElementById("a") as HTMLInputElement).focus();
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("b");
    press("Enter");
    expect(document.activeElement?.textContent).toBe("Aceptar");
    stop();
  });

  it("con el botón principal deshabilitado, Enter deja el foco en el campo", () => {
    const stop = installKeyboardRules();
    document.body.innerHTML = '<div role="dialog" aria-modal="true"><input id="a" /><button class="ga-btn-primary" disabled>Siguiente</button></div>';
    (document.getElementById("a") as HTMLInputElement).focus();
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe("a");
    stop();
  });

  it("los botones del marco salen del Tab y los números los aprietan, salvo escribiendo o con un diálogo abierto", () => {
    const clicks: string[] = [];
    document.body.innerHTML = '<div class="ga-dock"><button id="juegos">Juegos</button><button id="ninos">Niños</button></div><input id="buscar" />';
    document.querySelectorAll(".ga-dock button").forEach(button => button.addEventListener("click", () => clicks.push(button.id)));
    const stop = installKeyboardRules();
    expect((document.getElementById("ninos") as HTMLButtonElement).tabIndex).toBe(-1);
    expect(document.getElementById("ninos")?.getAttribute("aria-keyshortcuts")).toBe("2");
    press("2");
    expect(clicks).toEqual(["ninos"]);
    (document.getElementById("buscar") as HTMLInputElement).focus();
    press("1");
    expect(clicks).toEqual(["ninos"]);
    (document.activeElement as HTMLElement).blur();
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="true"><button>OK</button></div>');
    press("1");
    expect(clicks).toEqual(["ninos"]);
    stop();
  });
});
