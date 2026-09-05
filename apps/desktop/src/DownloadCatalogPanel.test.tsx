import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DownloadCatalogPanel from "./DownloadCatalogPanel";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const game: CatalogGame = { id: 1, slug: "installed", name: "Installed", app_id: 42, credit_cost_per_hour: 0, copies_total: 1, copies_available: 0 };
const installed: SteamDownloadStatus = { app_id: 42, state: "installed", progress: 100, bytes_downloaded: null, bytes_total: null, installed: true };

describe("DownloadCatalogPanel installed state", () => {
  it("keeps the green ready badge on a newly installed game even when no pool copy is free", () => {
    const markup = renderToStaticMarkup(<DownloadCatalogPanel games={[game]} downloads={{ 42: installed }} accountCount={1} selectedIndex={0} gridRef={createRef<HTMLDivElement>()} pinnedAppIds={new Set()} onSelect={() => undefined} />);
    expect(markup).toContain("library-install-state ready");
    expect(markup).toContain("Instalado · listo para jugar");
  });
});
