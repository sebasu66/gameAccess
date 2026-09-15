import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import DownloadCatalogPanel from "./DownloadCatalogPanel";
import SteamCover from "./SteamCover";
import { FeaturePanel, type FeaturePanelProps } from "./LibraryDetailPanel";
import type { CatalogGame } from "./types";
import type { ManagedDownloadStatus } from "./downloadTypes";

const game = { id: 1, app_id: 42, name: "Injustice", slug: "injustice", copies_total: 1, copies_available: 1, credit_cost_per_hour: 0 } as CatalogGame;
afterEach(() => vi.unstubAllGlobals());

describe("media identity across selection and game state", () => {
  it("keeps the verified portrait for every storage/download state and availability", () => {
    const url = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/hash/library_capsule.jpg";
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ url, savedAt: Date.now() }) });
    for (const state of ["not-installed", "downloading", "prepared", "installed", "frozen", "paused"] as const) {
      const status = { app_id: 42, state, progress: 50, installed: state === "installed" } as ManagedDownloadStatus;
      for (const copies_available of [0, 1]) {
        const markup = renderToStaticMarkup(<DownloadCatalogPanel games={[{ ...game, copies_available }]} downloads={{ 42: status }} accountCount={1} selectedIndex={0} gridRef={createRef<HTMLDivElement>()} pinnedAppIds={new Set()} onSelect={() => {}} />);
        const images = [...markup.matchAll(/<img[^>]+src="([^"]+)"/g)];
        expect(images.length).toBeGreaterThan(0);
        expect(images.every(image => image[1] === url)).toBe(true);
      }
    }
  });
  it("does not remount covers for metadata or availability changes", () => {
    expect(SteamCover({ game }).key).toBe(SteamCover({ game: { ...game, copies_available: 0, capsule_image: "changed.jpg" } }).key);
  });
  it("discards the entire desktop media state on game change but retains it for state updates", () => {
    const panel = (value: CatalogGame) => FeaturePanel({ game: value } as FeaturePanelProps);
    expect(panel(game).key).not.toBe(panel({ ...game, id: 2, app_id: 43 }).key);
    expect(panel(game).key).toBe(panel({ ...game, copies_available: 0 }).key);
  });
});
