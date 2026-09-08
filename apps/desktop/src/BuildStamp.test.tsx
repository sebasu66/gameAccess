import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BuildStamp, { backendConnectionLabel } from "./BuildStamp";

describe("build identity", () => {
  it("renders an embedded UTC timestamp that does not change with the launch clock", () => {
    const first = renderToStaticMarkup(<BuildStamp />);
    expect(first).toMatch(/Build: .*\d{4}-\d{2}-\d{2}T.*Z/);
    expect(first).toContain("Compilation time (UTC)");
    expect(first).toContain("Server: Checking");
    expect(renderToStaticMarkup(<BuildStamp />)).toBe(first);
  });

  it("uses human-readable local, remote and offline server labels", () => {
    expect(backendConnectionLabel("local")).toBe("Server: Local");
    expect(backendConnectionLabel("remote")).toBe("Server: Remote");
    expect(backendConnectionLabel("offline")).toBe("Server: Offline");
  });
});
