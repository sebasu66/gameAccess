import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BuildStamp from "./BuildStamp";

describe("build identity", () => {
  it("renders an embedded UTC timestamp that does not change with the launch clock", () => {
    const first = renderToStaticMarkup(<BuildStamp />);
    expect(first).toMatch(/Compilación: .*\d{4}-\d{2}-\d{2}T.*Z/);
    expect(first).toContain("Hora de compilación (UTC)");
    expect(first).not.toContain("Servidor:");
    expect(renderToStaticMarkup(<BuildStamp />)).toBe(first);
  });

});
