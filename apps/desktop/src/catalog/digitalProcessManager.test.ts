import { describe, expect, it } from "vitest";
import { DigitalProcessManager } from "./DigitalProcessManager";
import type { CatalogGame } from "../types";
import type { DigitalGameRecord } from "./DigitalCatalog";

describe("DigitalProcessManager", () => {
  const sampleGame: CatalogGame = {
    id: 2592160,
    slug: "dispatch",
    name: "Dispatch",
    app_id: 2592160,
    credit_cost_per_hour: 0,
    copies_total: 1,
    copies_available: 1,
    availability_state: "ready",
  };

  const sampleRecord: DigitalGameRecord = {
    id: 2592160,
    name: "Dispatch",
    downloadSource: "https://example.com/dispatch.zip",
    installProcess: "python setup.py",
    playProcess: "cd bin && dispatch.exe",
    uninstallProcess: "clean.bat",
  };

  it("executes playProcess and returns process result", async () => {
    const manager = new DigitalProcessManager();
    const result = await manager.executePlay(sampleGame, sampleRecord);

    expect(result.ok).toBe(true);
    expect(result.action).toBe("play");
    expect(result.command).toBe("cd bin && dispatch.exe");
    expect(result.app_id).toBe(2592160);
  });

  it("executes uninstallProcess and returns exit code", async () => {
    const manager = new DigitalProcessManager();
    const result = await manager.executeUninstall(sampleGame, sampleRecord);

    expect(result.ok).toBe(true);
    expect(result.action).toBe("uninstall");
    expect(result.command).toBe("clean.bat");
    expect(result.app_id).toBe(2592160);
  });

  it("throws clear error when playProcess is missing or empty", async () => {
    const manager = new DigitalProcessManager();
    const emptyRecord: DigitalGameRecord = {
      ...sampleRecord,
      playProcess: "",
    };

    await expect(manager.executePlay(sampleGame, emptyRecord)).rejects.toThrow(
      /no tiene configurado un 'playProcess'/
    );
  });

  it("throws clear error when uninstallProcess is missing or empty", async () => {
    const manager = new DigitalProcessManager();
    const emptyRecord: DigitalGameRecord = {
      ...sampleRecord,
      uninstallProcess: "",
    };

    await expect(manager.executeUninstall(sampleGame, emptyRecord)).rejects.toThrow(
      /no tiene configurado un 'uninstallProcess'/
    );
  });
});
