import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import shelfSource from "./LibrarySectionShelf.tsx?raw";
import pluginSourcesSource from "./catalog/PluginSources.ts?raw";
import { checkPluginSources, invalidatePluginSources } from "./catalog/PluginSources";
import { resourceGuard } from "./ResourceGuard";
import type { CatalogGame } from "./types";

describe("LibrarySection shelf resource guard wiring", () => {
  beforeEach(() => {
    invalidatePluginSources();
    resourceGuard.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The shelf mounts a bounded virtual window and reserves the rest of the list
  // with spacers. The real DOM ceiling and scrollbar contract are asserted by
  // mounting the component in LibrarySectionVirtualWindow.test.tsx.
  it("tracks mounted cards and reserves off-screen rows as spacers", () => {
    expect(shelfSource).toContain("resourceGuard.trackMountedCards");
    expect(shelfSource).toContain("library-section-grid");
    expect(shelfSource).toContain("computeShelfWindow");
    expect(shelfSource).toContain("paddingTop");
    expect(shelfSource).toContain("paddingBottom");
    expect(shelfSource).not.toContain("section.games.slice(0, visibleCount)");
  });

  it("leaves the source scan to the catalog sources hook", () => {
    expect(pluginSourcesSource).toContain("checkPluginSources");
    expect(shelfSource).not.toContain("checkPluginSources");
  });

  it("registers and releases async tasks with ResourceGuard during bulk checks", async () => {
    const games: CatalogGame[] = [{
      id: 999,
      app_id: 9999,
      slug: "test-game",
      name: "Test Game",
      credit_cost_per_hour: 0,
      copies_total: 1,
      copies_available: 1,
    }];

    // Mock fetch to resolve
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 9999: { count: 1, sources: ["TestSource"] } }),
    }));

    const metricsBefore = resourceGuard.getMetrics();
    const checkPromise = checkPluginSources(games);
    await checkPromise;
    const metricsAfter = resourceGuard.getMetrics();

    expect(metricsAfter.activeTasks).toBe(0);
  });
});
