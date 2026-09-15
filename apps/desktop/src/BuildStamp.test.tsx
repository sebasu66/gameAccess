import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BuildStamp, { backendConnectionLabel } from "./BuildStamp";

describe("build identity", () => {
  it("renders an embedded UTC timestamp that does not change with the launch clock", () => {
    const first = renderToStaticMarkup(<BuildStamp />);
    expect(first).toMatch(/Compilación: .*\d{4}-\d{2}-\d{2}T.*Z/);
    expect(first).toContain("Hora de compilación (UTC)");
    expect(first).toContain("Servidor: Comprobando");
    expect(renderToStaticMarkup(<BuildStamp />)).toBe(first);
  });

  it("uses human-readable local, remote and offline server labels", () => {
    expect(backendConnectionLabel("local")).toBe("Servidor: Local");
    expect(backendConnectionLabel("remote")).toBe("Servidor: Remoto");
    expect(backendConnectionLabel("offline")).toBe("Servidor: Sin conexión");
  });
});
