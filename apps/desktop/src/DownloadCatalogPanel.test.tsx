import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DownloadCatalogPanel from "./DownloadCatalogPanel";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const game: CatalogGame = { id: 1, slug: "installed", name: "Installed", app_id: 42, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 };
const installed: SteamDownloadStatus = { app_id: 42, state: "installed", progress: 100, bytes_downloaded: null, bytes_total: null, installed: true };

describe("DownloadCatalogPanel grid contract", () => {
  it("shows installed evidence without adding a Play action to the card", () => {
    const markup = renderToStaticMarkup(
      <DownloadCatalogPanel
        games={[game]}
        downloads={{ 42: installed }}
        accountCount={1}
        selectedIndex={0}
        gridRef={createRef<HTMLDivElement>()}
        pinnedAppIds={new Set()}
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain("library-install-state ready");
    expect(markup).toContain("data-install-folder-available=\"true\"");
    expect(markup).not.toContain("library-card-play");
    expect(markup).not.toContain("aria-label=\"Jugar Installed\"");
  });

  it("keeps the card as a selection target so Enter can transfer focus to the existing detail panel", () => {
    const markup = renderToStaticMarkup(
      <DownloadCatalogPanel
        games={[game]}
        downloads={{}}
        accountCount={1}
        selectedIndex={0}
        gridRef={createRef<HTMLDivElement>()}
        pinnedAppIds={new Set()}
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain("data-library-game-id=\"1\"");
    expect(markup).toContain("data-install-folder-available=\"false\"");
    expect(markup).toContain("aria-current=\"true\"");
    expect(markup).toContain("Seleccionado: Installed");
  });
});
