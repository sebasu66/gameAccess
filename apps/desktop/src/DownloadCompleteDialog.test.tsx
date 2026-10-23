import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import DownloadCompleteDialog from "./DownloadCompleteDialog";
import type { CatalogGame } from "./types";
import { setAppLocale, translate } from "./i18n";

const game = {
  id: 3171,
  app_id: 357830,
  name: "Attack of the Labyrinth +",
  hero_image: "https://example.test/library_hero.jpg",
} as CatalogGame;

describe("download completion dialog", () => {
  it("shows the game artwork, clean title and concise ready message in Spanish by default", () => {
    setAppLocale("es");
    const markup = renderToStaticMarkup(
      <DownloadCompleteDialog game={game} busy={false} onPlay={() => undefined} onClose={() => undefined} />,
    );

    expect(markup).toContain(translate("downloadComplete"));
    expect(markup).toContain(">Attack of the Labyrinth</h2>");
    expect(markup).not.toContain("Attack of the Labyrinth +</h2>");
    expect(markup).toContain(translate("readyToPlay"));
    expect(markup).toContain("library_hero.jpg");
    expect(markup).toContain(translate("playNow"));
    expect(markup).toContain(translate("notNow"));
  });

  it("shows localized content in English when English locale is selected", () => {
    setAppLocale("en");
    const markup = renderToStaticMarkup(
      <DownloadCompleteDialog game={game} busy={false} onPlay={() => undefined} onClose={() => undefined} />,
    );

    expect(markup).toContain("DOWNLOAD COMPLETE");
    expect(markup).toContain("Ready to play.");
    expect(markup).toContain("Play now");
    expect(markup).toContain("Not now");
    setAppLocale("es");
  });
});
