// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogGame } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GB = 1e9;
let settle: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
const freeze = vi.hoisted(() => vi.fn(() => new Promise((resolve, reject) => { settle = { resolve, reject }; })));
vi.mock("./catalog/DigitalProcessManager", () => ({ digitalProcessManager: { freeze, thaw: freeze } }));
vi.mock("./libraryScan", () => ({ scanLibrary: vi.fn(() => Promise.resolve()), libraryDemo: () => false }));

import FreezeDialog from "./FreezeDialog";
import { formatBytes } from "./GenericDownloadProgress";
import { freezeConsoleState, freezeJob } from "./freezeJobs";
import { setAppLocale } from "./i18n";
import { getNotice, hideNotice } from "./notice/notice";

const game = { id: 284160, app_id: 284160, name: "BeamNG.drive" } as CatalogGame;
let root: Root | null = null;
let host: HTMLElement | null = null;
const closed = vi.fn();

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(<FreezeDialog game={game} mode="freeze" onClose={closed} />); });
};
// Presses one of the notice's buttons by its label.
const press = async (label: string) => { await act(async () => { getNotice()!.actions.find(action => action.label === label)!.run(); }); };
const unmount = () => { act(() => { root?.unmount(); }); host?.remove(); root = null; host = null; };

beforeEach(() => { setAppLocale("es"); freeze.mockClear(); closed.mockClear(); hideNotice(); });
afterEach(() => { unmount(); hideNotice(); });

describe("freezing asks and answers in the app's notice", () => {
  it("asks in the notice, then the work goes on as a job and its result comes back as a notice that closes itself", async () => {
    mount();
    expect(getNotice()?.tone).toBe("frost");
    expect(getNotice()?.title).toContain("BeamNG.drive");
    await press("Congelar");
    expect(freeze).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalled();
    unmount();                                         // the game menu closed meanwhile: the job goes on
    await act(async () => { settle.resolve({ ok: true, frozen: { stored_bytes: 22.5 * GB, original_bytes: 53.7 * GB } }); });
    const result = getNotice()!;
    expect(result.title).toBe("Congelado completado");
    expect(result.text).toContain(formatBytes(22.5 * GB));
    expect(result.timer).toBe(true);
    expect(result.actions.map(action => action.label)).toEqual(["Aceptar"]);
    await press("Aceptar");                            // the notice goes and so does the finished job
    expect(getNotice()).toBeNull();
    expect(freezeConsoleState().jobs).toHaveLength(0);
  });

  it("cancelled in the notice, nothing starts", async () => {
    mount();
    await press("Cancelar");
    expect(freeze).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it("a failure waits in the notice, and the game can be frozen again", async () => {
    mount();
    await press("Congelar");
    unmount();
    await act(async () => { settle.reject(new Error("La compresión de Windows terminó con código 1")); });
    expect(getNotice()?.tone).toBe("error");
    expect(getNotice()?.timer).toBe(false);
    expect(getNotice()?.text).toContain("código 1");
    await press("Aceptar");
    mount();
    await press("Congelar");
    expect(freeze).toHaveBeenCalledTimes(2);
    await act(async () => { settle.resolve({ ok: true }); });
    await press("Aceptar");
  });

  it("asked again during the work, it brings up the same job instead of asking", async () => {
    mount();
    await press("Congelar");
    unmount();
    mount();
    expect(getNotice()).toBeNull();
    expect(freezeJob(game.app_id!)).toBeTruthy();
    expect(freeze).toHaveBeenCalledTimes(1);
    await act(async () => { settle.resolve({ ok: true }); });
    await press("Aceptar");
  });
});
