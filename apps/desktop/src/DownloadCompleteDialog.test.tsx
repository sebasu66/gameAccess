import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import DownloadCompleteDialog from "./DownloadCompleteDialog";
import type { CatalogGame } from "./types";

const game = {
  id: 3171,
  app_id: 357830,
  name: "Attack of the Labyrinth +",
  hero_image: "https://example.test/library_hero.jpg",
} as CatalogGame;

describe("download completion dialog", () => {
  it("shows the game artwork, clean title and concise ready message", () => {
    const markup = renderToStaticMarkup(
      <DownloadCompleteDialog game={game} busy={false} onPlay={() => undefined} onClose={() => undefined} />,
    );

    expect(markup).toContain("DOWNLOAD COMPLETE");
    expect(markup).toContain(">Attack of the Labyrinth</h2>");
    expect(markup).not.toContain("Attack of the Labyrinth +</h2>");
    expect(markup).toContain("Ready to play.");
    expect(markup).not.toContain("Los archivos ya est\u00e1n preparados");
    expect(markup).toContain("library_hero.jpg");
    expect(markup).toContain("Play now");
    expect(markup).toContain("Not now");
  });
});
