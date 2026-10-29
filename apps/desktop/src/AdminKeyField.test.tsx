// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asked: string[] = [];
vi.mock("./accessRole", () => ({ checkAdminKey: vi.fn(async (attempt: string) => { asked.push(attempt); return attempt === "AB123"; }) }));
vi.mock("./notice/notice", () => ({ showNotice: vi.fn() }));

import AdminKeyField from "./AdminKeyField";

let root: Root; let host: HTMLDivElement;
const onSuccess = vi.fn(); const onPlayer = vi.fn(); const onForgot = vi.fn();
const field = () => document.querySelector<HTMLInputElement>(".gs-lcd input")!;
const type = async (value: string) => {
  // What a keyboard does: the field's own value changes, then React hears an input event.
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { set.call(field(), value); field().dispatchEvent(new Event("input", { bubbles: true })); });
};

beforeEach(() => {
  vi.useFakeTimers(); asked.length = 0; onSuccess.mockClear(); onPlayer.mockClear(); onForgot.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<AdminKeyField length={5} onSuccess={onSuccess} onPlayer={onPlayer} onForgot={onForgot} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("portón: el campo de la clave de padre", () => {
  it("solo pregunta cuando lo escrito tiene el largo de la clave de hoy", async () => {
    await type("A"); await type("AB"); await type("AB1"); await type("AB12");
    expect(asked).toEqual([]);
    await type("AB124");
    expect(asked).toEqual(["AB124"]);
    expect(document.querySelector(".gs-lcd.is-ok")).toBeNull();
    // Passing the length does not ask again, and deleting and typing again is free.
    await type("AB1245");
    await type("AB12");
    await type("AB123");
    expect(asked).toEqual(["AB124", "AB123"]);
  });

  it("muestra solo círculos, nunca lo escrito", async () => {
    await type("AB1");
    expect(document.querySelectorAll(".gs-lcd-dots i").length).toBe(3);
    expect(document.querySelector(".gs-lcd")!.textContent).toBe("");
    expect(field().type).toBe("password");
  });

  it("al acertar se pone verde y abre solo, sin botón de confirmar", async () => {
    await type("AB123");
    expect(document.querySelector(".gs-lcd.is-ok")).not.toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect([...document.querySelectorAll("button")].map(button => button.textContent)).not.toContain("Aceptar");
  });

  it("deja entrar como jugador sin clave y avisa que se olvidó la clave", async () => {
    await act(async () => { [...document.querySelectorAll("button")].find(button => /jugador|player/i.test(button.textContent ?? ""))!.click(); });
    expect(onPlayer).toHaveBeenCalledTimes(1);
    await act(async () => { [...document.querySelectorAll("button")].find(button => /Olvid|forgot/i.test(button.textContent ?? ""))!.click(); });
    expect(onForgot).toHaveBeenCalledTimes(1);
  });
});
