import { describe, expect, it } from "vitest";
import { smokeTurn } from "./smokeStage";

describe("el humo único", () => {
  it("el primer diálogo solo aparece", () => {
    expect(smokeTurn([], ["a"])).toMatchObject({ open: ["a"], top: "a", arrived: true, returned: false, left: null });
  });
  it("uno que llama a otro queda abajo y el nuevo entra", () => {
    expect(smokeTurn(["a"], ["a", "b"])).toMatchObject({ open: ["a", "b"], top: "b", arrived: true, returned: false, left: null });
  });
  it("si el primero ya no hace falta, sale y lo reemplaza el nuevo", () => {
    expect(smokeTurn(["a"], ["b"])).toMatchObject({ open: ["b"], top: "b", arrived: true, left: "a" });
  });
  it("al cerrar el de arriba, vuelve el que seguía abierto", () => {
    expect(smokeTurn(["a", "b"], ["a"])).toMatchObject({ open: ["a"], top: "a", arrived: false, returned: true, left: "b" });
  });
  it("el último se va y no queda nada", () => {
    expect(smokeTurn(["a"], [])).toMatchObject({ open: [], top: null, left: "a" });
  });
  it("sin cambios no se mueve nada", () => {
    expect(smokeTurn(["a", "b"], ["a", "b"])).toMatchObject({ arrived: false, returned: false, left: null });
  });
  it("el recién llegado queda arriba aunque en la página esté antes", () => {
    expect(smokeTurn(["b"], ["a", "b"]).top).toBe("a");
  });
});
