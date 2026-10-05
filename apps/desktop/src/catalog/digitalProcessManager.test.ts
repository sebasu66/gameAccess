import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import { DigitalProcessManager } from "./DigitalProcessManager";
import type { CatalogGame } from "../types";
import type { DigitalGameRecord } from "./DigitalCatalog";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
const game = { id: 2592160, app_id: 2592160, name: "Dispatch" } as CatalogGame;
const record = { id: 2592160, name: "Dispatch", playProcess: "", uninstallProcess: "steam://uninstall/2592160" } as DigitalGameRecord;
describe("Digital folder lifecycle", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("lets the Digital runner discover an executable without a play command", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValue({ ok: true });
    await new DigitalProcessManager().executePlay(game, record, "C:/external");
    expect(invoke).toHaveBeenCalledWith("run_digital_process", expect.objectContaining({ action: "play", command: "", workingDir: null }));
  });
  it("deletes the Digital folder without executing uninstallProcess", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValue({ ok: true });
    await new DigitalProcessManager().executeUninstall(game, record);
    expect(invoke).toHaveBeenCalledWith("run_digital_process", expect.objectContaining({ action: "uninstall", command: "" }));
    expect(invoke).not.toHaveBeenCalledWith("uninstall_game", expect.anything());
  });
  it("probes actual folders in a single native snapshot", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValue({ ok: true, statuses: { 2592160: { installed: true } } });
    const status = await new DigitalProcessManager().snapshot([game]);
    expect(status.statuses?.[2592160].installed).toBe(true);
    expect(invoke).toHaveBeenCalledWith("run_digital_process", expect.objectContaining({ action: "snapshot", command: JSON.stringify([{ id: 2592160, name: "Dispatch" }]) }));
  });
  it("reports execution failures through support", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValue({ ok: false, error: "could not spawn" });
    await expect(new DigitalProcessManager().executePlay(game, record)).rejects.toThrow("could not spawn");
    expect(narrate).toHaveBeenCalledWith("Digital AppID 2592160 · play: could not spawn", { area: "DIGITAL_EXECUTION", level: "ERROR" });
  });
});
