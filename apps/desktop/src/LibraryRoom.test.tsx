import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LibraryRoom from "./LibraryRoom";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const game: CatalogGame = {
  id: 10,
  slug: "test-game",
  name: "Test Game",
  app_id: 10,
  credit_cost_per_hour: 0,
  copies_total: 1,
  copies_available: 1,
};

const installed: SteamDownloadStatus = {
  app_id: 10,
  state: "installed",
  progress: 100,
  bytes_downloaded: 1,
  bytes_total: 1,
  installed: true,
};

const downloading: SteamDownloadStatus = {
  app_id: 10,
  state: "downloading",
  progress: 50,
  bytes_downloaded: 1,
  bytes_total: 2,
  installed: false,
};

function render(downloads: Record<number, SteamDownloadStatus>, copiesAvailable = 1) {
  return renderToStaticMarkup(
    <LibraryRoom
      games={[{ ...game, copies_available: copiesAvailable }]}
      downloads={downloads}
      busy={false}
      onPlay={() => undefined}
      onDownload={() => undefined}
      onOpenDetails={() => undefined}
    />,
  );
}

describe("LibraryRoom grid presentation", () => {
  it("keeps game names accessible without rendering a title below each cover", () => {
    const markup = render({});
    expect(markup).toContain('aria-label="Seleccionado: Test Game"');
    expect(markup).not.toContain("Elegí un juego");
    expect(markup).not.toContain("<strong>Test Game</strong>");
  });

  it("shows only the green ready marker for an installed and available game", () => {
    const markup = render({ 10: installed });
    expect(markup).toContain("library-install-state ready");
  });

  it("shows no corner marker for downloading, missing, or unavailable games", () => {
    expect(render({ 10: downloading })).not.toContain("library-install-state");
    expect(render({})).not.toContain("library-install-state");
    expect(render({ 10: installed }, 0)).not.toContain("library-install-state");
  });
});
