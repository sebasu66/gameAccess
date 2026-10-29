// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: Array<[string, unknown]> = [];
const state = { lapsed: false };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    calls.push([command, args]);
    if (command === "admin_key_word") return "PERRO";
    if (command === "admin_key_set") { if (args?.current !== "perro") throw "wrong_key"; return { enabled: true, length: 10 }; }
    return null;
  }),
}));
vi.mock("./native", () => ({ hasTauriRuntime: () => true }));
vi.mock("./notice/notice", () => ({ showNotice: vi.fn() }));
vi.mock("./kidMode", () => ({ usePlus: () => true, useKidState: () => ({ applied: { name: "Tomi" } }) }));
vi.mock("./accessRole", () => ({
  loadAdminKey: vi.fn(async () => ({ enabled: true, length: 11 })),
  setAdminKey: vi.fn(),
  useAdminKey: () => ({ enabled: true, length: 11 }),
  usePlusLapsed: () => state.lapsed,
}));

import AdminKeySection from "./AdminKeySection";
import { translate } from "./i18n";

let root: Root; let host: HTMLDivElement;
const secret = () => document.querySelector(".ga-adminkey-secret")!.textContent;
const eye = () => document.querySelector<HTMLButtonElement>(".ga-adminkey-word button")!;
const type = async (input: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};
const render = async () => { await act(async () => root.render(<AdminKeySection />)); };

beforeEach(() => {
  calls.length = 0; state.lapsed = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("clave de padre: la palabra oculta", () => {
  it("se ve solo mientras se mantiene apretado el ojo, y la clave de hoy nunca se pide", async () => {
    await render();
    expect(secret()).toBe("••••••");
    await act(async () => { eye().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(secret()).toBe("PERRO");
    await act(async () => { eye().dispatchEvent(new MouseEvent("pointerup", { bubbles: true })); });
    expect(secret()).toBe("••••••");
    // With the keyboard: Space held shows it, released hides it.
    await act(async () => { eye().dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); });
    expect(secret()).toBe("PERRO");
    await act(async () => { eye().dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })); });
    expect(secret()).toBe("••••••");
    expect(calls.map(([command]) => command)).not.toContain("admin_key_today");
  });

  it("con PLUS terminado (todos son administrador) no ofrece verla", async () => {
    state.lapsed = true;
    await render();
    expect(document.querySelector(".ga-adminkey-word")).toBeNull();
  });

  it("cambiar la palabra pide la actual (o la clave de hoy) escrita por el padre", async () => {
    await render();
    await act(async () => { document.querySelector<HTMLButtonElement>(".ga-adminkey-actions button")!.click(); });
    const [current, word] = [...document.querySelectorAll<HTMLInputElement>(".ga-adminkey-form input")];
    const save = document.querySelector<HTMLButtonElement>(".ga-adminkey-form button")!;
    await type(word, "gato");
    expect(save.disabled).toBe(true);
    await type(current, "oso");
    await act(async () => { save.click(); });
    expect(document.querySelector("[role=alert]")?.textContent).toBe(translate("adminKeyWrong"));
    await type(current, "perro");
    await act(async () => { save.click(); });
    expect(calls.at(-1)).toEqual(["admin_key_set", { word: "gato", current: "perro" }]);
    expect(document.querySelector(".ga-adminkey-form")).toBeNull();
  });
});
