import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DigitalGameContextMenu from "./DigitalGameContextMenu";
import type { CatalogGame } from "./types";

describe("DigitalGameContextMenu", () => {
  const testGame: CatalogGame = {
    id: 100,
    slug: "test-game",
    name: "Test Game",
    app_id: 100,
    credit_cost_per_hour: 0,
    copies_total: 1,
    copies_available: 1,
    availability_state: "ready",
  };

  it("renders menu options matching the standard format", () => {
    const html = renderToStaticMarkup(
      <DigitalGameContextMenu
        request={{
          game: testGame,
          x: 100,
          y: 100,
          status: {
            app_id: 100,
            state: "installed",
            progress: 100,
            bytes_downloaded: null,
            bytes_total: null,
            installed: true,
          },
        }}
        onClose={() => {}}
      />
    );

    expect(html).toContain('role="menu"');
    expect(html).toContain("Instalar");
    expect(html).toContain("Jugar");
    expect(html).toContain("Abrir carpeta de instalación");
    expect(html).toContain("Desinstalar");
  });
});
