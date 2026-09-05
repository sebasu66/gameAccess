import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DownloadCatalogPanel, { cardPlayState } from "./DownloadCatalogPanel";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const game: CatalogGame = { id: 1, slug: "installed", name: "Installed", app_id: 42, credit_cost_per_hour: 0, copies_total: 1, copies_available: 0 };
const installed: SteamDownloadStatus = { app_id: 42, state: "installed", progress: 100, bytes_downloaded: null, bytes_total: null, installed: true };

describe("DownloadCatalogPanel installed actions", () => {
  it("keeps installed evidence visible even when no pool copy is free", () => {
    const markup = renderToStaticMarkup(<DownloadCatalogPanel games={[game]} downloads={{ 42: installed }} accountCount={1} selectedIndex={0} gridRef={createRef<HTMLDivElement>()} pinnedAppIds={new Set()} onSelect={() => undefined} onPlay={() => undefined} />);
    expect(markup).toContain("library-install-state ready");
    expect(markup).toContain("library-card-play");
    expect(markup).toContain("disabled=\"\"");
    expect(cardPlayState(game, installed)).toMatchObject({ installed: true, licensed: false });
  });

  it("renders a separate enabled Play sibling when an installed game has a license", () => {
    const playable = { ...game, copies_available: 1 };
    const markup = renderToStaticMarkup(<DownloadCatalogPanel games={[playable]} downloads={{ 42: installed }} accountCount={1} selectedIndex={0} gridRef={createRef<HTMLDivElement>()} pinnedAppIds={new Set()} onSelect={() => undefined} onPlay={() => undefined} />);
    expect(markup).toContain("aria-label=\"Jugar Installed\"");
    expect(markup).not.toContain("aria-label=\"Jugar Installed\" disabled");
    expect(cardPlayState(playable, installed)).toMatchObject({ installed: true, licensed: true });
  });
});
