import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LibraryGame } from "./catalog/DigitalProcessManager";

let entry: Partial<LibraryGame> | undefined;
vi.mock("./libraryScan", async original => ({ ...(await original<typeof import("./libraryScan")>()), useLibraryEntry: () => entry, useLibraryFlag: () => undefined }));

import DownloadCatalogPanel from "./DownloadCatalogPanel";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const game: CatalogGame = { id: 1, slug: "portal-2", name: "Portal 2", app_id: 620, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 };
const installed: SteamDownloadStatus = { app_id: 620, state: "installed", progress: 100, bytes_downloaded: null, bytes_total: null, installed: true };
const render = () => renderToStaticMarkup(<DownloadCatalogPanel games={[game]} downloads={{ 620: installed }} selectedIndex={0}
  gridRef={createRef<HTMLDivElement>()} pinnedAppIds={new Set()} onSelect={() => undefined} />);

describe("a game that did not open, in the grid", () => {
  it("shows the warning, with why in its tooltip", () => {
    entry = { app_id: 620, name: "Portal 2", state: "ready", issues: [], run_check: { state: "cantRun", at: "2026-11-02T10:00:00", detail: "it closed by itself after 3 s" } };
    const markup = render();
    expect(markup).toContain("ga-card-flag");
    expect(markup).toContain("No abrió en esta PC: it closed by itself after 3 s");
  });

  it("shows nothing for a game that ran fine", () => {
    entry = { app_id: 620, name: "Portal 2", state: "ready", issues: [], run_check: { state: "checked", at: "2026-11-02T10:00:00", detail: "" } };
    expect(render()).not.toContain("ga-card-flag");
  });
});
