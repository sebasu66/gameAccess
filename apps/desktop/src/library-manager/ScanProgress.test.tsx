import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanProgress } from "./ScanProgress";
import { copy } from "./copy";

describe("ScanProgress", () => {
  it("shows the folder being read, the counts and each game found so far", () => {
    const html = renderToStaticMarkup(<ScanProgress c={copy.es} progress={{ folder: "D:\\Games\\Hades", folders: 42, done: false, cancelled: false, started: 0,
      found: [{ name: "Hades", path: "D:\\Games\\Hades", size_bytes: 15 * 1024 ** 3, kind: "steam", app_id: 1145360 }] }} />);
    expect(html).toContain("D:\\Games\\Hades");
    expect(html).toContain("Carpetas revisadas: 42");
    expect(html).toContain("Juegos encontrados: 1");
    expect(html).toContain("Steam");
  });

  it("before the first folder it says it is getting ready and that nothing turned up yet", () => {
    const html = renderToStaticMarkup(<ScanProgress c={copy.en} progress={null} />);
    expect(html).toContain("Getting ready");
    expect(html).toContain("No game has turned up yet.");
  });
});
