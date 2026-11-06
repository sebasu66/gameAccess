// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RelocationPlan } from "./catalog/DigitalProcessManager";

const calls = vi.hoisted(() => ({ relocate: [] as Array<[number, string, string]>, finished: 0 }));
vi.mock("./catalog/DigitalProcessManager", () => ({
  digitalProcessManager: {
    relocate: async (appId: number, target: string, mode: string) => {
      calls.relocate.push([appId, target, mode]);
      return { relocated: { app_id: appId, ok: true, mode: appId === 2 ? "move" : mode } };
    },
    relocateFinish: async () => { calls.finished += 1; return { ok: true }; },
  },
}));
vi.mock("./libraryScan", () => ({ scanLibrary: async () => undefined }));
vi.mock("./i18n", async importOriginal => { const actual = await importOriginal<typeof import("./i18n")>(); return { ...actual, useI18n: () => ({ locale: "es", t: (key: Parameters<typeof import("./i18n").translate>[0], params?: import("./i18n").TranslationParams) => actual.translate(key, params, "es") }) }; });
import LibraryRelocation from "./LibraryRelocation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan: RelocationPlan = {
  target: "C:\\GA_Juegos", copy_bytes: 0, free_bytes: 500e9, room: true,
  games: [
    { app_id: 1, name: "Alpha", folder: "D:\\old\\1-Alpha-ready", size_bytes: 5e9, same_disk: false, fits: true, taken: false, must_move: false },
    { app_id: 2, name: "Beta", folder: "D:\\old\\2-Beta-downloading", size_bytes: 1e9, same_disk: false, fits: true, taken: false, must_move: true },
    { app_id: 3, name: "Gamma", folder: "D:\\old\\3-Gamma-ready", size_bytes: 1e9, same_disk: false, fits: false, taken: false, must_move: false },
  ],
};

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); calls.relocate = []; calls.finished = 0; });

async function mount(onDone: (message: string) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<LibraryRelocation plan={plan} onDone={onDone} />); });
  return host;
}

describe("LibraryRelocation", () => {
  it("moves every game by default, linking only the ones whose paths would not fit, then closes the old folders", async () => {
    const done = vi.fn();
    const view = await mount(done);
    expect(view.textContent).toContain("Juegos en otras carpetas: 3");
    await act(async () => { view.querySelector<HTMLButtonElement>(".ga-btn-primary")!.click(); });
    expect(calls.relocate).toEqual([[1, "C:\\GA_Juegos", "move"], [2, "C:\\GA_Juegos", "move"], [3, "C:\\GA_Juegos", "link"]]);
    expect(calls.finished).toBe(1);
    expect(done).toHaveBeenCalledWith(expect.stringContaining("Movidos: 2 · vinculados: 1"));
  });

  it("without moving, links the games (an unfinished download still moves)", async () => {
    const done = vi.fn();
    const view = await mount(done);
    await act(async () => { view.querySelector<HTMLButtonElement>("#ga-relocate-all")!.click(); });
    expect(view.textContent).toContain("juegos vinculados");
    await act(async () => { view.querySelector<HTMLButtonElement>(".ga-btn-primary")!.click(); });
    expect(calls.relocate.map(call => call[2])).toEqual(["link", "link", "link"]);
    expect(done).toHaveBeenCalledWith(expect.stringContaining("Movidos: 1 · vinculados: 2"));
  });
});
