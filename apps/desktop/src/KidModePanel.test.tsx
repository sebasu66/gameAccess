// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// PLUS is on for this flow; the rest of kidMode.ts is the real one (no Tauri: "Apply" and "Remove" only change the state).
vi.mock("./kidMode", async importOriginal => ({ ...(await importOriginal<typeof import("./kidMode")>()), usePlus: () => true }));
vi.mock("./notice/notice", () => ({ showNotice: vi.fn(), confirmNotice: vi.fn(async () => true), hideNotice: vi.fn() }));

import KidModePanel from "./KidModePanel";
import { setKidDraft, NEW_KID } from "./kidMode";

let root: Root; let host: HTMLDivElement;
const text = () => document.querySelector(".ga-kid-panel")?.textContent ?? "";
const press = async (label: RegExp) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".ga-kid-panel button")].find(item => label.test(item.textContent ?? ""));
  if (!button) throw new Error(`no button ${label}; panel says: ${text().slice(0, 200)}`);
  await act(async () => { button.click(); });
};

beforeEach(() => { localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Modo niño: de la explicación al panel y de vuelta a cero", () => {
  it("recorre el asistente, llega al panel y lo deshace", async () => {
    setKidDraft({ ...NEW_KID, name: "", games: [] });
    await act(async () => { root.render(<KidModePanel />); });
    await act(async () => { document.querySelector<HTMLButtonElement>(".ga-kid-fab")?.click(); });

    // 1. The page that explains the feature, with its button open because PLUS is on.
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

    // 4. The account exists: the same dialog is the panel, with the week, the live orders and the way back.
    expect(text()).toContain("Juan");
    expect(text()).toMatch(/Esta semana|This week/);
    expect(text()).toMatch(/Parar el juego ahora|Stop the game now/);
    expect(document.querySelector(".ga-kid-intro")).toBeNull();

    // 5. Remove kid mode: back to the explanation, nothing configured.
    await press(/Quitar el modo niño|Remove kid mode/);
    expect(document.querySelector(".ga-kid-intro")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("gameaccess.kidDraft") ?? "null")).toBeNull();
  });
});
