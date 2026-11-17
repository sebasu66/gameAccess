import { beforeEach, describe, expect, it } from "vitest";
import type { CatalogGame } from "../types";
import { digitalProcessManager } from "./DigitalProcessManager";
import { isAskingForKey, resetAccessRoleForTests, setAdminKey } from "../accessRole";

const game = { id: 7, app_id: 7, name: "Juego" } as unknown as CatalogGame;

// Everything that changes the library or the storage, as the process manager exposes it.
const libraryActions: Array<[string, () => Promise<unknown>]> = [
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

// Seba, 2026-10-31: the child has a Windows account of its own, so the parent's Game Access is used freely; only
// parental control asks for the parent's key (vault/Modo niño.md).
describe("clave de padre: la biblioteca no la pide", () => {
  beforeEach(() => { resetAccessRoleForTests(); setAdminKey({ enabled: true, length: 11 }); });

  it.each(libraryActions)("%s corre sin pedir la clave", async (_name, run) => {
    const attempt = run();
    expect(isAskingForKey()).toBe(false);
    await expect(attempt).resolves.toBeDefined();
  });
});
