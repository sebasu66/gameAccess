import { describe, expect, it } from "vitest";
import { packPills } from "./pillRows";

describe("pastillas que llenan las filas", () => {
  it("una más corta sube a llenar el hueco de la fila de arriba", () => {
    // Instrucciones, Preguntas frecuentes, Contacto en un panel donde no entran las tres.
    expect(packPills([130, 190, 110], 320, 10)).toEqual([0, 2, 1]);
  });
  it("si entran todas, quedan en el orden del árbol", () => {
    expect(packPills([80, 90, 70], 400, 10)).toEqual([0, 1, 2]);
  });
  it("una más ancha que el panel ocupa su fila sola", () => {
    expect(packPills([500, 60, 60], 300, 10)).toEqual([0, 1, 2]);
    expect(packPills([60, 500, 60], 300, 10)).toEqual([0, 2, 1]);
  });
});
