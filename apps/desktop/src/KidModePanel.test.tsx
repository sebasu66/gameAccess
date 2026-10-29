// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// PLUS is on for this flow; the rest of kidMode.ts is the real one (no Tauri: "Apply" and "Remove" only change the state).
vi.mock("./kidMode", async importOriginal => ({ ...(await importOriginal<typeof import("./kidMode")>()), usePlus: () => true }));
vi.mock("./notice/notice", () => ({ showNotice: vi.fn(), confirmNotice: vi.fn(async () => true), hideNotice: vi.fn() }));
// The filter's tab has its own screen and tests: here it only has to be a tab.
vi.mock("./ParentalControlSection", () => ({ default: () => <p>filtro</p> }));

import KidModePanel from "./KidModePanel";
import { setKidDraft, NEW_KID, resetKidMode } from "./kidMode";
import { resetHasKidsForTests } from "./familyPrefs";
import { resetAccessRoleForTests, setAdminKey, setPlusGraceDays, setPlusLapsed } from "./accessRole";

let root: Root; let host: HTMLDivElement;
const text = () => document.querySelector(".ga-kid-panel")?.textContent ?? "";
const press = async (label: RegExp) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".ga-kid-panel button")].find(item => label.test(item.textContent ?? ""));
  if (!button) throw new Error(`no button ${label}; panel says: ${text().slice(0, 200)}`);
  await act(async () => { button.click(); });
};
const open = async () => {
  await act(async () => { root.render(<KidModePanel />); });
  await act(async () => { document.querySelector<HTMLButtonElement>(".ga-kid-fab")?.click(); });
};

beforeEach(async () => {
  // Each test starts from zero: no account made, nothing answered, no key, PLUS fine.
  await resetKidMode();
  localStorage.clear(); resetHasKidsForTests(); resetAccessRoleForTests();
  setKidDraft({ ...NEW_KID, name: "", games: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Niños en casa: una sola pantalla para todo", () => {
  it("empieza preguntando si hay niños y, si no los hay, no pide nada", async () => {
    await open();
    expect(text()).toMatch(/¿Hay niños en tu casa\?|Are there children/);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    await press(/No hay niños|No children/);
    expect(text()).toMatch(/No hay niños en casa|No children at home/);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    // It can be changed later.
    await press(/Ahora hay niños|There are children now/);
    expect(document.querySelectorAll('[role="tab"]').length).toBe(3);
  });

  it("recorre el asistente, llega al panel y lo deshace", async () => {
    await open();
    await press(/Sí, hay niños|Yes, there are/);
    // Everything about the children is a tab of this one screen.
    expect([...document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/Modo niño|Kid mode/), expect.stringMatching(/Filtro|filter/i), expect.stringMatching(/Clave|key/i)]));

    // 1. The page that explains kid mode, with its button open because PLUS is on.
    expect(text()).toMatch(/pelea|fight/i);
    await press(/Empezar|Start/);

    // 2. The account: "Next" waits for a valid name.
    const next = () => [...document.querySelectorAll<HTMLButtonElement>(".ga-kid-panel button")].find(item => /Siguiente|Next/.test(item.textContent ?? ""))!;
    expect(next().disabled).toBe(true);
    await act(async () => { setKidDraft({ name: "Juan" }); });
    expect(next().disabled).toBe(false);
    await press(/Siguiente|Next/);

    // 3. Time and hours come filled in: two hours, 12-21 on weekdays, 9-22 on weekends.
    const values = [...document.querySelectorAll<HTMLSelectElement>(".ga-kid-panel select")].map(select => select.value);
    expect(values).toEqual(["120", "12", "21", "9", "22"]);
    await press(/Crear la cuenta|Create the account/);

    // 4. The account exists: the same tab is the panel, with the week, the live orders and the way back.
    expect(text()).toContain("Juan");
    expect(text()).toMatch(/Esta semana|This week/);
    expect(text()).toMatch(/Parar el juego ahora|Stop the game now/);
    expect(document.querySelector(".ga-kid-intro")).toBeNull();

    // 5. With the account made, "there are no children" is refused until it is removed.
    await press(/Ya no hay niños|no children at home any more/);
    expect(text()).toMatch(/primero quitá|first remove/);

    // 6. Remove kid mode: back to the explanation, nothing configured.
    await press(/Quitar el modo niño|Remove kid mode/);
    expect(document.querySelector(".ga-kid-intro")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("gameaccess.kidDraft") ?? "null")).toBeNull();
  });

  it("el filtro de contenido y la clave de padre viven en las otras pestañas", async () => {
    await open();
    await press(/Sí, hay niños|Yes, there are/);
    await press(/Filtro de contenido|Content filter/);
    expect(text()).toContain("filtro");
    await press(/Clave de padre|Parent's key/);
    expect(text()).toMatch(/cambia todos los días|changes every day/);
    expect(text()).toMatch(/P1E1R1R1O26|D1O1G1126/);
  });

  it("si se apaga PLUS avisa que el modo niño está en pausa y la clave sin efecto, y no borra nada", async () => {
    setKidDraft({ ...NEW_KID, name: "Juan", games: [] });
    await open();
    await press(/Sí, hay niños|Yes, there are/);
    expect(text()).not.toMatch(/PLUS no está activo|PLUS is not active/);
    await press(/Empezar|Start/);
    await act(async () => { setKidDraft({ name: "Juan" }); });
    await press(/Siguiente|Next/);
    await press(/Crear la cuenta|Create the account/);
    await act(async () => { setAdminKey({ enabled: true, length: 11 }); setPlusLapsed(true); });
    expect(text()).toMatch(/PLUS no está activo|PLUS is not active/);
    expect(text()).toMatch(/en pausa|paused/);
    // Nothing was deleted: the account is still there, and PLUS coming back clears the notice.
    expect(text()).toContain("Juan");
    await act(async () => { setPlusLapsed(false); });
    expect(text()).not.toMatch(/PLUS no está activo|PLUS is not active/);
  });

  it("sin conexión avisa cuántos días de gracia quedan y no pausa nada", async () => {
    setKidDraft({ ...NEW_KID, name: "Juan", games: [] });
    await open();
    await press(/Sí, hay niños|Yes, there are/);
    await press(/Empezar|Start/);
    await act(async () => { setKidDraft({ name: "Juan" }); });
    await press(/Siguiente|Next/);
    await press(/Crear la cuenta|Create the account/);
    await act(async () => { setPlusGraceDays(4); });
    expect(text()).toMatch(/No se pudo verificar tu PLUS|could not be checked/);
    expect(text()).toMatch(/4 día|4 more day/);
    expect(text()).not.toMatch(/en pausa/);
    await act(async () => { setPlusGraceDays(null); });
    expect(text()).not.toMatch(/No se pudo verificar tu PLUS|could not be checked/);
  });
});
