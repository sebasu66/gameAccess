// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// PLUS is on for this flow; the rest of kidMode.ts is the real one (no Tauri: "Apply" and "Remove" only change the state).
const plus = vi.hoisted(() => ({ on: true }));
vi.mock("./kidMode", async importOriginal => ({ ...(await importOriginal<typeof import("./kidMode")>()), usePlus: () => plus.on }));
vi.mock("./notice/notice", () => ({ showNotice: vi.fn(), confirmNotice: vi.fn(async () => true), hideNotice: vi.fn() }));
// The filter has its own screen and tests: here it only has to be there.
vi.mock("./ParentalControlSection", () => ({ default: () => <p>filtro</p> }));

import KidModePanel from "./KidModePanel";
import { setKidDraft, NEW_KID, resetKidMode } from "./kidMode";
import { getAdminKey, resetAccessRoleForTests, setAccessRole, setAdminKey, setPlusGraceDays, setPlusLapsed } from "./accessRole";

let root: Root; let host: HTMLDivElement;
const panel = () => document.querySelector(".ga-kid-panel")!;
const text = () => panel()?.textContent ?? "";
const button = (label: RegExp) => [...panel().querySelectorAll<HTMLButtonElement>("button")].find(item => label.test(item.textContent ?? ""));
const press = async (label: RegExp) => {
  const found = button(label);
  if (!found) throw new Error(`no button ${label}; panel says: ${text().slice(0, 300)}`);
  await act(async () => { found.click(); });
};
/** Types into a React-controlled field. */
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const open = async () => {
  await act(async () => { root.render(<KidModePanel />); });
  await act(async () => { document.querySelector<HTMLButtonElement>(".ga-kid-fab")?.click(); });
};
/** The whole wizard: key, filter, the child's account, its games, and finish. */
const finishWizard = async (name = "Juan") => {
  await press(/^Empezar|^Start/);
  await type(panel().querySelector<HTMLInputElement>(".ga-kid-step input")!, "perro");
  await press(/Siguiente: filtro|Next: content filter/);
  await press(/Siguiente: la cuenta|Next: your child/);
  await act(async () => { setKidDraft({ name }); });
  await press(/Siguiente: sus juegos|Next: their games/);
  await press(/Crear la cuenta|Create the account/);
};

beforeEach(async () => {
  // Each test starts from zero: no account made, no key, PLUS fine.
  plus.on = true;
  await resetKidMode();
  localStorage.clear(); resetAccessRoleForTests();
  setKidDraft({ ...NEW_KID, name: "", games: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Niños en casa", () => {
  it("abre siempre con la página que explica, con o sin PLUS; sin PLUS no empieza", async () => {
    plus.on = false;
    await open();
    expect(text()).toMatch(/¿Tenés niños en casa\?|Do you have children/);
    expect(text()).toMatch(/sin peleas|no fights/);
    expect(text()).toMatch(/Filtro de contenido para adultos|Adult content filter/);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    await press(/Activá PLUS para empezar|Activate PLUS/);
    expect(document.querySelector(".ga-kid-step")).toBeNull();
    expect(button(/Conocer PLUS|PLUS/)).toBeTruthy();
  });

  it("el asistente muestra un paso por vez en un escenario fijo: clave, filtro, cuenta y juegos; Atrás vuelve sin perder nada", async () => {
    await open();
    await press(/^Empezar|^Start/);
    expect(panel().querySelectorAll(".ga-kid-step")).toHaveLength(1);
    expect(panel().querySelector(".ga-kid-step h3")!.textContent).toMatch(/funciones de padres|parents' functions/);
    // 1. The parent's key: Next waits for a valid word.
    expect(button(/Siguiente: filtro|Next: content filter/)!.disabled).toBe(true);
    await type(panel().querySelector<HTMLInputElement>(".ga-kid-step input")!, "perro");
    await press(/Siguiente: filtro|Next: content filter/);
    // The key is kept only when the wizard finishes: leaving it halfway leaves nothing the opening asks for.
    expect(getAdminKey()).toEqual({ enabled: false, length: 0 });
    // 2. The filter takes the key's place: still one step on screen (the dialog does not grow) and step 1 is marked done.
    expect(panel().querySelectorAll(".ga-kid-step")).toHaveLength(1);
    expect(panel().querySelector(".ga-kid-step h3")!.textContent).toMatch(/Filtro de contenido|content filter/i);
    expect(panel().querySelectorAll(".ga-kid-progress .is-done")).toHaveLength(1);
    // Back: step 1 again, with the word still typed; Back once more: the page that explains.
    await press(/^Atrás|^Back/);
    expect(panel().querySelector<HTMLInputElement>(".ga-kid-step input")!.value).toBe("perro");
    await press(/^Atrás|^Back/);
    expect(panel().querySelector(".ga-kid-step")).toBeNull();
    expect(panel().querySelector(".ga-kid-intro")).not.toBeNull();
    // Start again: no key was kept, so it asks for it again, and the word is still there.
    await press(/^Empezar|^Start/);
    expect(panel().querySelector<HTMLInputElement>(".ga-kid-step input")!.value).toBe("perro");
    await press(/Siguiente: filtro|Next: content filter/);
    await press(/Siguiente: la cuenta|Next: your child/);
    // 3. The account: Next waits for a valid name.
    expect(button(/Siguiente: sus juegos|Next: their games/)!.disabled).toBe(true);
    await act(async () => { setKidDraft({ name: "Juan" }); });
    // A finished step's chip goes back to it, and what was typed stays.
    const chip = (index: string) => [...panel().querySelectorAll<HTMLButtonElement>(".ga-kid-progress button")].find(item => item.textContent === index)!;
    await act(async () => { chip("2").click(); });
    expect(panel().querySelector(".ga-kid-step h3")!.textContent).toMatch(/Filtro de contenido|content filter/i);
    await press(/Siguiente: la cuenta|Next: your child/);
    expect(panel().querySelector<HTMLInputElement>(".ga-kid-step input")!.value).toBe("Juan");
    await press(/Siguiente: sus juegos|Next: their games/);
    // 4. The games, then finish: kid mode is on and the screen is the control panel.
    expect(text()).toMatch(/qué juegos verá tu hijo|which games your child will see/);
    await press(/Crear la cuenta|Create the account/);
    expect(getAdminKey()).toEqual({ enabled: true, length: 5 });
    expect(document.querySelector(".ga-kid-intro")).toBeNull();
    expect([...document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual([
      expect.stringMatching(/Juegos|Games/), expect.stringMatching(/Tiempo|Time/), expect.stringMatching(/Filtro|filter/i), expect.stringMatching(/Soporte|Support/),
    ]);
  });

  it("la cuenta trae un horario por día ya cargado, y en los juegos Ninguno saca todos de una vez", async () => {
    await open();
    await act(async () => { setKidDraft({ games: [{ appId: 10, name: "Tetris", folder: "C:/Juegos/Tetris", executable: "", arguments: [], steam: false }] }); });
    await press(/^Empezar|^Start/);
    await type(panel().querySelector<HTMLInputElement>(".ga-kid-step input")!, "perro");
    await press(/Siguiente: filtro|Next: content filter/);
    await press(/Siguiente: la cuenta|Next: your child/);
    // Monday first: two hours from 12 to 21; Saturday and Sunday three hours from 9 to 22.
    const rows = [...panel().querySelectorAll<HTMLTableRowElement>(".ga-kid-schedule tbody tr")];
    expect(rows).toHaveLength(7);
    const values = (row: HTMLTableRowElement) => [...row.querySelectorAll("select")].map(select => select.value);
    expect(values(rows[0])).toEqual(["120", "12", "21"]);
    expect(values(rows[5])).toEqual(["180", "9", "22"]);
    const from = rows[0].querySelectorAll("select")[1];
    await act(async () => { from.value = "15"; from.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(values(panel().querySelectorAll<HTMLTableRowElement>(".ga-kid-schedule tbody tr")[0])).toEqual(["120", "15", "21"]);
    await act(async () => { setKidDraft({ name: "Juan" }); });
    await press(/Siguiente: sus juegos|Next: their games/);
    expect(text()).toContain("Tetris");
    await press(/^Ninguno|^None/);
    expect(text()).not.toContain("Tetris");
  });

  it("panel: cada juego con Sí/No y su límite general o específico de a 30 minutos", async () => {
    await open();
    await act(async () => { setKidDraft({ games: [{ appId: 10, name: "Tetris", folder: "C:/Juegos/Tetris", executable: "", arguments: [], steam: false }] }); });
    await finishWizard();
    const row = () => [...panel().querySelectorAll("tr.lm-row")].find(item => item.textContent?.includes("Tetris"))!;
    expect(row().querySelector(".ga-kid-switch")!.getAttribute("aria-pressed")).toBe("true");
    const limit = row().querySelector<HTMLSelectElement>("select")!;
    expect(limit.value).toBe("general");
    await act(async () => { limit.value = "specific"; limit.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(row().querySelector("output")!.textContent).toBe("1:00 h");
    await act(async () => { row().querySelectorAll<HTMLButtonElement>(".ga-kid-spinner button")[1].click(); });
    expect(row().querySelector("output")!.textContent).toBe("1:30 h");
    expect(text()).toMatch(/Hay cambios sin aplicar|not applied yet/);
  });

  it("como jugador no hay control parental: su botón y su pantalla salen del marco y vuelven con el modo padre", async () => {
    await open();
    await finishWizard();
    await act(async () => { setAccessRole("player"); });
    expect(document.querySelector(".ga-kid-panel")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".ga-kid-fab")!.hidden).toBe(true);
    await act(async () => { setAccessRole("admin"); });
    expect(document.querySelector<HTMLButtonElement>(".ga-kid-fab")!.hidden).toBe(false);
  });

  it("Soporte y configuración: la clave de padre, la ayuda y quitar el modo niño, que vuelve a la explicación", async () => {
    await open();
    await finishWizard();
    await press(/Soporte|Support/);
    expect(text()).toMatch(/Ayuda y contacto|Help & contact/);
    expect(text()).toMatch(/elegís vos|you choose/);
    await press(/Quitar el modo niño|Remove kid mode/);
    expect(document.querySelector(".ga-kid-intro")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("gameaccess.kidDraft") ?? "null")).toBeNull();
  });

  it("si se apaga PLUS avisa que el modo niño está en pausa y la clave sin efecto, y no borra nada", async () => {
    await open();
    await finishWizard();
    await act(async () => { setAdminKey({ enabled: true, length: 11 }); setPlusLapsed(true); });
    expect(text()).toMatch(/PLUS no está activo|PLUS is not active/);
    expect(text()).toMatch(/en pausa|paused/);
    expect(text()).toContain("Juan");
    await act(async () => { setPlusLapsed(false); });
    expect(text()).not.toMatch(/PLUS no está activo|PLUS is not active/);
  });

  it("sin conexión avisa cuántos días de gracia quedan y no pausa nada", async () => {
    await open();
    await finishWizard();
    await act(async () => { setPlusGraceDays(4); });
    expect(text()).toMatch(/No se pudo verificar tu PLUS|could not be checked/);
    expect(text()).toMatch(/4 día|4 more day/);
    await act(async () => { setPlusGraceDays(null); });
    expect(text()).not.toMatch(/No se pudo verificar tu PLUS|could not be checked/);
  });
});
