// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KidReadyDialog from "./KidReadyDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLDivElement;
const dialog = () => document.querySelector('[role="alertdialog"]');
const render = async (protectedAccount: boolean | null, steam: boolean, onClose = vi.fn()) => {
  await act(async () => { root.render(<KidReadyDialog name="Juan" protectedAccount={protectedAccount} steam={steam} onClose={onClose} />); });
  return onClose;
};

beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("fin del asistente: la cuenta del niño está lista", () => {
  it("confirma la cuenta y cómo funciona, sin aclaraciones cuando no hacen falta", async () => {
    await render(true, false);
    expect(dialog()?.textContent).toMatch(/cuenta de Juan está lista|Juan's account is ready/);
    expect(dialog()?.textContent).toMatch(/cerrá sesión o cambiá de usuario|sign out or switch user/);
    expect(dialog()?.textContent).not.toMatch(/Aclaraciones|Notes/);
  });

  it("sin contraseña en la cuenta del padre aconseja ponerla y explica cómo, plegado", async () => {
    await render(false, false);
    expect(dialog()?.textContent).toMatch(/Protegé tu cuenta|Protect your Windows account/);
    const how = dialog()!.querySelector("details.ga-disclosure")!;
    expect(how.hasAttribute("open")).toBe(false);
    expect(how.textContent).toMatch(/Opciones de inicio de sesión|Sign-in options/);
  });

  it("con juegos de Steam avisa que la primera vez pide iniciar sesión y marcar Recordarme", async () => {
    await render(null, true);
    expect(dialog()?.textContent).toMatch(/Recordarme en este equipo|Remember me on this computer/);
    // Unknown whether the account has a password: nothing is advised.
    expect(dialog()?.textContent).not.toMatch(/Protegé tu cuenta|Protect your Windows account/);
  });

  it("Entendido lo cierra", async () => {
    const onClose = await render(true, true);
    await act(async () => { [...dialog()!.querySelectorAll("button")].find(button => /Entendido|Got it/.test(button.textContent ?? ""))!.click(); });
    expect(onClose).toHaveBeenCalled();
  });
});
