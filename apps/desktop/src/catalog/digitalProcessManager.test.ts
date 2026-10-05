import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import { supplyArchivePasswords } from "./archivePasswords";
import { DigitalProcessManager } from "./DigitalProcessManager";
import type { CatalogGame } from "../types";
import type { DigitalGameRecord } from "./DigitalCatalog";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./archivePasswords", () => ({ supplyArchivePasswords: vi.fn().mockResolvedValue(undefined) }));
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
  it("supplies central passwords before restoring an encrypted backup", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true, backup_requires_password: true }).mockResolvedValueOnce({ ok: true });
    await new DigitalProcessManager().executePlay(game, record);
    expect(supplyArchivePasswords).toHaveBeenCalledWith(2592160);
    expect(vi.mocked(invoke).mock.calls.map(call => (call[1] as any).action)).toEqual(["status", "play"]);
  });
  it("reports restore failure and refuses unsuccessful Play results", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "backup extraction failed" });
    await expect(new DigitalProcessManager().executePlay(game, record)).rejects.toThrow("backup extraction failed");
    expect(narrate).toHaveBeenCalledWith("Digital AppID 2592160 · play: backup extraction failed", { area: "DIGITAL_EXECUTION", level: "ERROR" });
  });
  it("reports execution failures through support", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValue({ ok: false, error: "could not spawn" });
    await expect(new DigitalProcessManager().executePlay(game, record)).rejects.toThrow("could not spawn");
    expect(narrate).toHaveBeenCalledWith("Digital AppID 2592160 · play: could not spawn", { area: "DIGITAL_EXECUTION", level: "ERROR" });
  });
});

it("propagates automatic source policy and skips backup passwords", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.mocked(invoke).mockResolvedValue({ ok: true, backup_requires_password: true });
  await new DigitalProcessManager().executePlay(game, { ...record, auto_installed: true });
  expect(supplyArchivePasswords).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("run_digital_process", expect.objectContaining({ action: "status", autoInstalled: true }));
  expect(invoke).toHaveBeenCalledWith("run_digital_process", expect.objectContaining({ action: "play", autoInstalled: true }));
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
