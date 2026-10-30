// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogGame } from "./types";

const pending: Array<{ resolve: (value: unknown) => void }> = [];
const freeze = vi.hoisted(() => vi.fn());
const signal = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const libraryBatch = vi.hoisted(() => vi.fn());
vi.mock("./catalog/DigitalProcessManager", () => ({ digitalProcessManager: { freeze, thaw: freeze, libraryBatch } }));
vi.mock("./libraryScan", () => ({ scanLibrary: vi.fn(() => Promise.resolve()), libraryDemo: () => false, libraryScanState: () => ({ games: [] }) }));
vi.mock("./native", () => ({ freezeProgress: () => Promise.resolve(null), freezeSignal: signal, hasTauriRuntime: () => true }));

import { cancelFreezeJob, freezeConsoleState, freezeJob, pauseFreezesWhilePlaying, resumeFreezes, runningFreezeJob, startFreezeJob } from "./freezeJobs";
import { getNotice, hideNotice } from "./notice/notice";
import { setAppLocale } from "./i18n";

const game = (id: number, name: string) => ({ id, app_id: id, name }) as CatalogGame;

beforeEach(() => {
  setAppLocale("es");
  freeze.mockReset();
  freeze.mockImplementation(() => new Promise(resolve => { pending.push({ resolve }); }));
  signal.mockClear();
  pending.length = 0;
  hideNotice();
});

describe("freezing: one game at a time", () => {
  it("a second freeze waits in the queue and starts by itself when the first one ends", async () => {
    const first = startFreezeJob(game(1, "Alpha"), "freeze");
    const second = startFreezeJob(game(2, "Beta"), "deep");
    expect(freeze).toHaveBeenCalledTimes(1);
    expect(second.queued).toBe(true);
    expect(getNotice()?.title).toBe("En cola");
    expect(runningFreezeJob()?.appId).toBe(1);
    await act(async () => { pending[0].resolve({ ok: true }); await first.done; });
    expect(freeze).toHaveBeenCalledTimes(2);
    expect(freeze.mock.calls[1][1]).toBe("deep");
    expect(runningFreezeJob()?.appId).toBe(2);
    await act(async () => { pending[1].resolve({ ok: true }); await second.done; });
    expect(runningFreezeJob()).toBeUndefined();
    hideNotice();
  });

  it("a queued freeze is just taken out of the queue; a working one is asked to stop and reports a cancel", async () => {
    const first = startFreezeJob(game(3, "Gamma"), "freeze");
    const second = startFreezeJob(game(4, "Delta"), "freeze");
    cancelFreezeJob(4);
    expect(freezeJob(4)).toBeUndefined();
    expect((await second.done).cancelled).toBe(true);
    cancelFreezeJob(3);
    expect(signal).toHaveBeenCalledWith(3, "cancel");
    expect(freezeJob(3)?.cancelling).toBe(true);
    await act(async () => { pending[0].resolve({ ok: true, cancelled: true }); await first.done; });
    expect(getNotice()?.title).toBe("Congelado cancelado");
    expect(getNotice()?.timer).toBe(true);
    expect(freeze).toHaveBeenCalledTimes(1);                 // the one taken out of the queue never ran
    hideNotice();
    expect(freezeConsoleState().jobs.find(job => job.appId === 3)).toBeUndefined();
  });

  it("while a game is played the freeze waits, and goes on after", async () => {
    const job = startFreezeJob(game(5, "Epsilon"), "freeze");
    pauseFreezesWhilePlaying();
    expect(signal).toHaveBeenCalledWith(0, "pause");
    expect(freezeConsoleState().paused).toBe(true);
    resumeFreezes();
    expect(signal).toHaveBeenCalledWith(0, "resume");
    await act(async () => { pending[0].resolve({ ok: true }); await job.done; });
    hideNotice();
  });
});

describe("moving a linked game into the library: a job like a freeze", () => {
  it("waits behind a freeze, runs the launcher's move, and tells the size and time in the notice", async () => {
    let finishMove: (value: unknown) => void = () => undefined;
    libraryBatch.mockReset();
    libraryBatch.mockImplementation(() => new Promise(resolve => { finishMove = resolve; }));
    const frozen = startFreezeJob(game(5, "Epsilon"), "freeze");
    const move = startFreezeJob(game(6, "Zeta"), "move");
    expect(move.queued).toBe(true);
    expect(libraryBatch).not.toHaveBeenCalled();
    await act(async () => { pending[0].resolve({ ok: true }); await frozen.done; });
    expect(libraryBatch).toHaveBeenCalledWith("linked_move", [6]);
    expect(runningFreezeJob()?.mode).toBe("move");
    await act(async () => { finishMove({ results: [{ app_id: 6, ok: true, moved_bytes: 5 * 1024 ** 3, seconds: 125 }] }); await move.done; });
    const outcome = await move.done;
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain("2:05");
    expect(getNotice()?.title).toBe("Juego movido a la biblioteca");
    hideNotice();
  });

  it("continuing a move cut short asks the launcher to resume it, not to start over", async () => {
    libraryBatch.mockReset();
    libraryBatch.mockResolvedValueOnce({ results: [{ app_id: 9, ok: true, moved_bytes: 1024 ** 3, resumed_bytes: 512 * 1024 ** 2, seconds: 30 }] });
    expect((await startFreezeJob(game(9, "Iota"), "move", { resume: true }).done).ok).toBe(true);
    expect(libraryBatch).toHaveBeenCalledWith("linked_move_resume", [9]);
    hideNotice();
  });

  it("a cancelled move says the game stays linked; a refused one says why", async () => {
    libraryBatch.mockReset();
    libraryBatch.mockResolvedValueOnce({ results: [{ app_id: 7, ok: false, cancelled: true }] });
    expect((await startFreezeJob(game(7, "Eta"), "move").done)).toMatchObject({ ok: false, cancelled: true });
    hideNotice();
    libraryBatch.mockResolvedValueOnce({ results: [{ app_id: 8, ok: false, error: "No hay espacio" }] });
    const refused = await startFreezeJob(game(8, "Theta"), "move").done;
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain("No hay espacio");
    hideNotice();
  });
});
