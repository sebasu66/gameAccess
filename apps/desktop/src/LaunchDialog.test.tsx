// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogGame } from "./types";

const process = vi.hoisted(() => ({
  diagnoseLaunch: vi.fn(async () => ({ checks: [{ id: "steam_running", ok: false }, { id: "path_symbols", ok: true }] })),
  autoFix: vi.fn(async () => ({ fix: { steam: true, language: null, runtimes: [], fixBackup: false, runAsAdmin: false } })),
  openFolder: vi.fn(async () => ({})),
}));
vi.mock("./catalog/DigitalProcessManager", () => ({ digitalProcessManager: process }));
vi.mock("./native", () => ({ launchProgress: vi.fn(async () => null), hasTauriRuntime: () => false }));
vi.mock("./catalog/runFixes", async () => {
  const real = await vi.importActual<typeof import("./catalog/runFixes")>("./catalog/runFixes");
  return { ...real, fetchRunFix: vi.fn(async () => null) };
});

import LaunchDialog from "./LaunchDialog";
import { beginLaunch, closeLaunch, getLaunch, launchFailed, useLaunch } from "./launchSession";
import { takeLearnedFix } from "./catalog/runFixes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const game = { id: 7, app_id: 7, name: "Naruto" } as CatalogGame;
let root: Root; let host: HTMLDivElement;

function Harness({ onRetry }: { onRetry: (game: CatalogGame, autoFixed: boolean) => void }) {
  const session = useLaunch();
  return session ? <LaunchDialog session={session} onRetry={onRetry} /> : null;
}
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>(".ga-launch footer button")].map(button => button.textContent?.trim());
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => { closeLaunch(); root.unmount(); }); host.remove(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("launch dialog", () => {
  it("blocks for 10 seconds (no close, Escape does nothing), then turns into the error mode", async () => {
    await act(async () => { root.render(<Harness onRetry={vi.fn()} />); });
    await act(async () => { beginLaunch(game); });
    expect(document.querySelector(".ga-launch.is-starting")).not.toBeNull();
    expect(document.querySelector(".ga-launch .ga-close")).toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(getLaunch()).not.toBeNull();
    await flush(9000);
    expect(document.querySelector(".ga-launch.is-starting")).not.toBeNull();
    await flush(1500);
    expect(document.querySelector(".ga-launch.is-error")).not.toBeNull();
    expect(document.querySelector(".ga-launch .ga-close")).not.toBeNull();
    expect(process.diagnoseLaunch).toHaveBeenCalledTimes(1);
  });

  it("offers auto fix and cancel; the fix relaunches once, and a second failure offers the exe's location and cancel", async () => {
    const retry = vi.fn();
    await act(async () => { root.render(<Harness onRetry={retry} />); });
    await act(async () => { launchFailed(beginLaunch(game).id, "boom"); });
    await flush(10);
    expect(buttons()).toHaveLength(2);
    expect(buttons()[0]).toMatch(/Intentar arreglarlo solo|Try to fix it automatically/);
    expect(buttons()[1]).toMatch(/Cancelar|Cancel/);
    expect(document.querySelector(".ga-launch-checks li.bad")?.textContent).toMatch(/Steam/);
    await act(async () => { document.querySelector<HTMLButtonElement>(".ga-launch footer .ga-btn-primary")!.click(); });
    await flush(10);
    expect(process.autoFix).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(game, true);
    expect(takeLearnedFix(7)).toMatchObject({ steam: true });  // held until the game opens
    // The relaunch failed too.
    await act(async () => { launchFailed(beginLaunch(game, true).id, "boom again"); });
    await flush(10);
    expect(buttons()).toHaveLength(2);
    expect(buttons()[0]).toMatch(/ubicación del ejecutable|executable.s location/);
  });

  it("Cancel closes it", async () => {
    await act(async () => { root.render(<Harness onRetry={vi.fn()} />); });
    await act(async () => { launchFailed(beginLaunch(game).id, "boom"); });
    await flush(10);
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>(".ga-launch footer button")].pop()!.click(); });
    expect(getLaunch()).toBeNull();
  });
});
