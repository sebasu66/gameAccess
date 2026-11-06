// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCatalogQuery, isCatalogCapped } from "./useCatalogQuery";
import * as catalogCache from "./catalogCache";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("isCatalogCapped", () => {
  it("returns false when total fits within items count and is under 1000", () => {
    expect(isCatalogCapped(50, 50)).toBe(false);
    expect(isCatalogCapped(0, 0)).toBe(false);
  });

  it("returns true when total exceeds items count", () => {
    expect(isCatalogCapped(100, 70)).toBe(true);
  });

  it("returns true when total exceeds hard cap of 1000 even if items equals total", () => {
    expect(isCatalogCapped(1200, 1000)).toBe(true);
  });
});

describe("useCatalogQuery hook", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    root = null;
    container = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces query and updates items, total, and capped", async () => {
    const mockGames = [
      { id: 1, name: "Game 1", app_id: 101, slug: "g1", credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 },
      { id: 2, name: "Game 2", app_id: 102, slug: "g2", credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 },
    ];
    const querySpy = vi.spyOn(catalogCache, "queryCatalogCache").mockResolvedValue({
      items: mockGames,
      total: 150,
    });

    let hookResult: any;
    function TestComponent({ query }: { query: string }) {
      hookResult = useCatalogQuery({ query, debounceMs: 250, limit: 70 });
      return null;
    }

    act(() => {
      root!.render(<TestComponent query="Action" />);
    });

    expect(hookResult?.loading).toBe(true);
    expect(querySpy).not.toHaveBeenCalled();

    // Fast-forward past debounce
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({
      query: "Action",
      limit: 70,
      offset: 0,
    }));
    expect(hookResult?.loading).toBe(false);
    expect(hookResult?.items).toEqual(mockGames);
    expect(hookResult?.total).toBe(150);
    expect(hookResult?.capped).toBe(true); // 150 > 2 items
  });

  it("cancels stale in-flight queries when query changes rapidly", async () => {
    let resolveFirst: (val: any) => void;
    const firstPromise = new Promise(resolve => { resolveFirst = resolve; });
    const secondResult = {
      items: [{ id: 99, name: "Latest", app_id: 999, slug: "latest", credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 }],
      total: 1,
    };

    const querySpy = vi.spyOn(catalogCache, "queryCatalogCache")
      .mockImplementationOnce(() => firstPromise as any)
      .mockResolvedValueOnce(secondResult);

    let hookResult: any;
    function TestComponent({ query }: { query: string }) {
      hookResult = useCatalogQuery({ query, debounceMs: 100 });
      return null;
    }

    // First query
    act(() => {
      root!.render(<TestComponent query="first" />);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(querySpy).toHaveBeenCalledTimes(1);

    // Second query before first resolves
    act(() => {
      root!.render(<TestComponent query="second" />);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(querySpy).toHaveBeenCalledTimes(2);

    // Now resolve first late
    await act(async () => {
      resolveFirst!({
        items: [{ id: 1, name: "Stale", app_id: 1, slug: "stale", credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 }],
        total: 10,
      });
    });

    // Result must be from the latest query, not the stale first query
    expect(hookResult?.items[0]?.name).toBe("Latest");
    expect(hookResult?.total).toBe(1);
    expect(hookResult?.capped).toBe(false);
  });

  it("does not trigger queries when enabled is false", async () => {
    const querySpy = vi.spyOn(catalogCache, "queryCatalogCache").mockResolvedValue({
      items: [],
      total: 0,
    });

    let hookResult: any;
    function TestComponent() {
      hookResult = useCatalogQuery({ enabled: false, debounceMs: 50 });
      return null;
    }

    act(() => {
      root!.render(<TestComponent />);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(querySpy).not.toHaveBeenCalled();
    expect(hookResult?.loading).toBe(false);
  });
});
