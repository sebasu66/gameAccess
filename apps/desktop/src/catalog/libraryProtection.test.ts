import { beforeEach, describe, expect, it } from "vitest";
import type { CatalogGame } from "../types";
import { digitalProcessManager } from "./DigitalProcessManager";
import { AdminRequiredError, isAskingForKey, resetAccessRoleForTests, setAccessRole, setAdminKey, settleGateRequest } from "../accessRole";

const game = { id: 7, app_id: 7, name: "Juego" } as unknown as CatalogGame;

// Everything that changes the library or the storage, as the process manager exposes it.
const protectedActions: Array<[string, () => Promise<unknown>]> = [
  ["desinstalar", () => digitalProcessManager.executeUninstall(game)],
  ["desinstalar en lote", () => digitalProcessManager.libraryBatch("uninstall", [7])],
  ["borrar un juego vinculado", () => digitalProcessManager.libraryBatch("linked_delete", [7])],
  ["mover la biblioteca", () => digitalProcessManager.relocate(7, "D:/juegos", "move")],
  ["terminar de mover", () => digitalProcessManager.relocateFinish()],
  ["importar juegos", () => digitalProcessManager.importRun([])],
  ["congelar", () => digitalProcessManager.freeze(game, "freeze")],
  ["descongelar", () => digitalProcessManager.thaw(game)],
  ["cambiar las carpetas de juegos", () => digitalProcessManager.saveSettings({} as never)],
];

describe("clave de padre: modificar la biblioteca", () => {
  beforeEach(() => { resetAccessRoleForTests(); setAdminKey({ enabled: true, length: 11 }); setAccessRole("player"); });

  it.each(protectedActions)("%s pide la clave y no corre si se entra como jugador", async (_name, run) => {
    const attempt = run();
    expect(isAskingForKey()).toBe(true);
    settleGateRequest(false);
    await expect(attempt).rejects.toBeInstanceOf(AdminRequiredError);
  });

  it.each(protectedActions)("%s corre cuando la clave abre el portón", async (_name, run) => {
    const attempt = run();
    expect(isAskingForKey()).toBe(true);
    settleGateRequest(true);
    await expect(attempt).resolves.toBeDefined();
  });

  it("cancelar una descarga no pide la clave: no cambia la biblioteca", async () => {
    const attempt = digitalProcessManager.libraryBatch("discard_transfer", [7]);
    expect(isAskingForKey()).toBe(false);
    await expect(attempt).resolves.toBeDefined();
  });

  it("sin clave de padre nada se pide", async () => {
    resetAccessRoleForTests();
    const attempt = digitalProcessManager.libraryBatch("uninstall", [7]);
    expect(isAskingForKey()).toBe(false);
    await expect(attempt).resolves.toBeDefined();
  });
});
