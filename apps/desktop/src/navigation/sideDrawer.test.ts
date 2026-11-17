import { describe, expect, it } from "vitest";
import { drawerState } from "./sideDrawer";

describe("cajón de la columna izquierda", () => {
  it("se acopla solo si entra y no se plegó a mano", () => {
    expect(drawerState(true, false, false)).toBe("docked");
    expect(drawerState(true, true, false)).toBe("closed");
  });
  it("si no entra queda cerrado y la pestaña lo abre encima del contenido", () => {
    expect(drawerState(false, false, false)).toBe("closed");
    expect(drawerState(false, false, true)).toBe("open");
    expect(drawerState(false, true, true)).toBe("open");
  });
});
