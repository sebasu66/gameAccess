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
vi.mock("./libraryScan", () => ({ scanLibrary: vi.fn(() => Promise.resolve()) }));

import FreezeDialog from "./FreezeDialog";
import { formatBytes } from "./GenericDownloadProgress";
import { setAppLocale } from "./i18n";
import { getToasts, dismissToast } from "./toasts";

const game = { id: 284160, app_id: 284160, name: "BeamNG.drive" } as CatalogGame;
let root: Root | null = null;
let host: HTMLElement | null = null;

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(<FreezeDialog game={game} mode="freeze" onClose={() => undefined} />); });
  return host;
};
const confirm = (view: HTMLElement) => {
  act(() => { view.ownerDocument.querySelector<HTMLButtonElement>(".ga-dialog-primary")!.click(); });
};
// The game menu closes (Esc, another game, leaving the detail): the dialog it owned goes with it.
const closeMenu = () => { act(() => { root?.unmount(); }); host?.remove(); root = null; host = null; };

beforeEach(() => { setAppLocale("es"); freeze.mockClear(); getToasts().forEach(toast => dismissToast(toast.id)); });
afterEach(closeMenu);

describe("a freeze outlives the dialog that started it", () => {
  it("reports the result when the menu was closed during the compression", async () => {
    confirm(mount());
    expect(freeze).toHaveBeenCalledTimes(1);
    closeMenu();
    await act(async () => { settle.resolve({ ok: true, frozen: { stored_bytes: 22.5 * GB, original_bytes: 53.7 * GB } }); });
    const toast = getToasts().at(-1);
    expect(toast?.tone).toBe("success");
    expect(toast?.message).toContain("BeamNG.drive");
    expect(toast?.message).toContain(formatBytes(22.5 * GB));
  });

  it("reports a failure when the menu was closed, and the game can be frozen again", async () => {
    confirm(mount());
    closeMenu();
    await act(async () => { settle.reject(new Error("La compresión de Windows terminó con código 1")); });
    const toast = getToasts().at(-1);
    expect(toast?.tone).toBe("error");
    expect(toast?.message).toContain("La compresión de Windows terminó con código 1");
    confirm(mount());
    expect(freeze).toHaveBeenCalledTimes(2);
    await act(async () => { settle.resolve({ ok: true }); });
  });

  it("reopening the dialog during the work shows the same job instead of starting a second one", async () => {
    confirm(mount());
    closeMenu();
    const view = mount();
    expect(view.ownerDocument.body.textContent).toContain("Comprimiendo el juego");
    expect(freeze).toHaveBeenCalledTimes(1);
    await act(async () => { settle.resolve({ ok: true, frozen: { stored_bytes: 1 * GB, original_bytes: 2 * GB } }); });
    expect(view.ownerDocument.body.textContent).toContain("Ahora ocupa");
    expect(getToasts()).toHaveLength(0);  // the open dialog already says it
  });
});
