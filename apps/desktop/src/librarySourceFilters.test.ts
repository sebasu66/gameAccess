import { describe, expect, it } from "vitest";
import { DEFAULT_LIBRARY_FILTERS, withoutSourceFilters } from "./librarySearch";

describe("source filters without a source plugin", () => {
  it("drops the sources and 'has downloads', keeps every other criterion", () => {
    const filters = { ...DEFAULT_LIBRARY_FILTERS, features: ["has_downloads", "coop"], sources: ["A"], excludeSources: ["B"], genres: ["action"] } as typeof DEFAULT_LIBRARY_FILTERS;
    const stripped = withoutSourceFilters(filters);
    expect(stripped.sources).toBeUndefined();
    expect(stripped.excludeSources).toBeUndefined();
    expect(stripped.features).toEqual(["coop"]);
    expect(stripped.genres).toEqual(["action"]);
    expect(filters.sources).toEqual(["A"]);
  });

  it("returns the same filters when there is nothing to drop", () => {
    expect(withoutSourceFilters(DEFAULT_LIBRARY_FILTERS)).toBe(DEFAULT_LIBRARY_FILTERS);
  });
});
