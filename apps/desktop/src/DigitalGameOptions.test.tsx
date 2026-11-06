// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogGame } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gameOptions = vi.hoisted(() => vi.fn());
const saveLaunchCommand = vi.hoisted(() => vi.fn());
const saveGameOptions = vi.hoisted(() => vi.fn());
vi.mock("./catalog/DigitalProcessManager", () => ({ digitalProcessManager: { gameOptions, saveLaunchCommand, saveGameOptions } }));
vi.mock("./catalog/ExecutionProfiles", () => ({ emptyAutomation: {}, loadAutomation: () => Promise.resolve({}), saveAutomation: () => Promise.resolve() }));

import DigitalGameOptions from "./DigitalGameOptions";
import { setAppLocale } from "./i18n";

const game = { id: 1145360, app_id: 1145360, name: "Hades" } as CatalogGame;
let root: Root; let host: HTMLElement;
afterEach(() => { act(() => root.unmount()); host.remove(); });

const mount = async () => {
  setAppLocale("es");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<DigitalGameOptions game={game} onClose={() => undefined} />); });
};
const type = (input: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("un juego vinculado de Steam", () => {
  it("muestra solo su comando de ejecución, con el de siempre como guía y la ayuda de las formas de ejecutarlo", async () => {
    gameOptions.mockResolvedValue({ ok: true, linked: true, command: "", default_command: "steam://rungameid/1145360" });
    await mount();
    const input = host.querySelector<HTMLTextAreaElement>("#game-command")!;
    expect(input.placeholder).toBe("steam://rungameid/1145360");
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector('[aria-controls="game-command-help"]')).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBe("game-command-help");
    expect(host.querySelector("#game-command-help")?.textContent).toContain("-applaunch");
    expect(host.querySelectorAll("#game-command-help details")).toHaveLength(3);
    expect([...host.querySelectorAll<HTMLDetailsElement>("#game-command-help details")].some(item => item.open)).toBe(false);
  });
  it("guarda el comando escrito a mano", async () => {
    gameOptions.mockResolvedValue({ ok: true, linked: true, command: "", default_command: "steam://rungameid/1145360" });
    saveLaunchCommand.mockResolvedValue({ ok: true, linked: true, command: "steam://run/1145360//-dx11/", default_command: "steam://rungameid/1145360" });
    await mount();
    act(() => type(host.querySelector<HTMLTextAreaElement>("#game-command")!, "steam://run/1145360//-dx11/"));
    await act(async () => { host.querySelector<HTMLButtonElement>("footer > button")!.click(); });
    expect(saveLaunchCommand).toHaveBeenCalledWith(game, "steam://run/1145360//-dx11/");
    expect(host.textContent).toContain("Opciones guardadas.");
  });
});

describe("un juego vinculado de una carpeta", () => {
  const folderOptions = { ok: true, linked: true, kind: "folder", executables: ["Goat2.exe", "Binaries\Goat2-Win64.exe"],
    options: { executable: "", arguments: "", administrator: false, language: "", backupEnabled: false, backupArchive: "" } };
  it("tiene el ejecutable, los argumentos y administrador, sin el comando de Steam ni idioma", async () => {
    gameOptions.mockResolvedValue(folderOptions);
    await mount();
    expect(host.querySelector("#game-command")).toBeNull();
    expect([...host.querySelectorAll("select option")].map(option => option.textContent)).toEqual(["Detectar automáticamente", "Goat2.exe", "Binaries\Goat2-Win64.exe"]);
    expect(host.querySelector('input[placeholder="-windowed"]')).not.toBeNull();
    expect(host.textContent).toContain("Ejecutar como administrador");
    expect(host.textContent).not.toContain("Idioma del juego");
  });
  it("guarda sus opciones como las de cualquier juego", async () => {
    gameOptions.mockResolvedValue(folderOptions);
    saveGameOptions.mockResolvedValue({ ...folderOptions, options: { ...folderOptions.options, executable: "Goat2.exe" } });
    await mount();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    act(() => { select.value = "Goat2.exe"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>("footer > button")!.click(); });
    expect(saveGameOptions).toHaveBeenCalledWith(game, expect.objectContaining({ executable: "Goat2.exe", arguments: "", administrator: false }));
    expect(host.textContent).toContain("Opciones guardadas.");
  });
});
