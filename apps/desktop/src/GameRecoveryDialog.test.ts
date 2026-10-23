import { describe, expect, it } from "vitest";
import { fileInProgress, isBrokenInstall, suggestionFor } from "./GameRecoveryDialog";
describe("game recovery helpers", () => {
  it("reads the file a step was processing", () => {
    expect(fileInProgress("error intentando descomprimir Game.part1.rar: contraseña incorrecta")).toBe("Game.part1.rar");
    expect(fileInProgress("error intentando instalar setup_x.exe: el instalador terminó con código 5")).toBe("setup_x.exe");
    expect(fileInProgress("sin pistas")).toBe("");
  });
  it("detects a broken install from Play errors", () => {
    expect(isBrokenInstall("Ningun ejecutable candidato funciono. Ultimo error: x")).toBe(true);
    expect(isBrokenInstall("No se encontraron ejecutables validos en la carpeta.")).toBe(true);
    expect(isBrokenInstall("Se canceló la autorización de administrador.")).toBe(false);
  });
  it("suggests the matching fix", () => {
    expect(suggestionFor("404 not found", "error", "es")).toContain("otra fuente");
    expect(suggestionFor("error intentando descomprimir a.rar: x", "error", "es")).toContain("contraseña");
    expect(suggestionFor("x", "broken", "en")).toContain("reinstall");
  });
});
