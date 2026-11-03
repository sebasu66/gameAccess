import { describe, expect, it } from "vitest";
import { catalogParamsFromFilters } from "./catalogFilterParams";
import { DEFAULT_LIBRARY_FILTERS } from "./librarySearch";

describe("catalog query from the filters", () => {
  it("says whether unrated games stay whenever there is a score bar", () => {
    const params = (spareUnprovenGames?: boolean) => catalogParamsFromFilters("", { ...DEFAULT_LIBRARY_FILTERS, minReviewScore: 70, spareUnprovenGames }, []);
    // Unset is "no", as the library filter reads it; the Rust query would read a missing value as "yes".
    expect(params(undefined).include_recent_unrated).toBe(false);
    expect(params(false).include_recent_unrated).toBe(false);
    expect(params(true).include_recent_unrated).toBe(true);
    expect(catalogParamsFromFilters("", DEFAULT_LIBRARY_FILTERS, []).include_recent_unrated).toBeUndefined();
  });
});
