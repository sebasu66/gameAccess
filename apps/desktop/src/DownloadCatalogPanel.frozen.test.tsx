import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LibraryGame } from "./catalog/DigitalProcessManager";

const GB = 1024 ** 3;
let entry: Partial<LibraryGame> | undefined;
vi.mock("./libraryScan", async original => ({ ...(await original<typeof import("./libraryScan")>()), useLibraryEntry: () => entry, useLibraryFlag: () => undefined }));

import DownloadCatalogPanel from "./DownloadCatalogPanel";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const game: CatalogGame = { id: 1, slug: "portal-2", name: "Portal 2", app_id: 620, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 };
const installed: SteamDownloadStatus = { app_id: 620, state: "installed", progress: 100, bytes_downloaded: null, bytes_total: null, installed: true };
const render = () => renderToStaticMarkup(<DownloadCatalogPanel games={[game]} downloads={{ 620: installed }} selectedIndex={0}
  gridRef={createRef<HTMLDivElement>()} pinnedAppIds={new Set()} onSelect={() => undefined} />);

describe("a frozen game in the grid", () => {
  it("shows a snowflake, what it takes now and, faded, its real size", () => {
    entry = { app_id: 620, name: "Portal 2", state: "ready", frozen: "deep", frozen_bytes: 9 * GB, original_bytes: 15 * GB, size_bytes: 15 * GB, issues: [] };
    const markup = render();
    expect(markup).toContain("ga-card-frozen is-deep");
    expect(markup).toContain("<b>9.0 GB</b><span>15 GB</span>");
    expect(markup).toContain("Se descongela al jugar");
  });

  it("shows nothing for a game that is not frozen", () => {
    entry = { app_id: 620, name: "Portal 2", state: "ready", size_bytes: 15 * GB, issues: [] };
    expect(render()).not.toContain("ga-card-frozen");
  });
});
