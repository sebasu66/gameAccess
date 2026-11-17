import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { queryCatalogCache, type CatalogQueryParams } from "./catalogCache";
import type { CatalogGame } from "./types";

/** Fired after a catalog sync changed the local database, so open queries run again. */
export const CATALOG_DATA_CHANGED_EVENT = "gameaccess:catalog-data-changed";

export interface UseCatalogQueryOptions extends CatalogQueryParams {
  debounceMs?: number;
  enabled?: boolean;
}

export interface UseCatalogQueryResult {
  items: CatalogGame[];
  total: number;
  capped: boolean;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function isCatalogCapped(total: number, itemsCount: number, hardCap: number = 1000): boolean {
  return total > hardCap || total > itemsCount;
}

export function useCatalogQuery(options: UseCatalogQueryOptions = {}): UseCatalogQueryResult {
  const [items, setItems] = useState<CatalogGame[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const reqIdRef = useRef(0);

  const debounceMs = options.debounceMs ?? 250;
  const limit = options.limit ?? 70;
  const offset = options.offset ?? 0;
  const enabled = options.enabled ?? true;

  const refresh = useCallback(() => {
    setRefreshTick(t => t + 1);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSourcesChanged = (event: Event) => {
      // One game's source discovery does not change the database answer.
      if ((event as CustomEvent<{ scope?: string }>).detail?.scope === "game") return;
      setRefreshTick(t => t + 1);
    };
    window.addEventListener("gameaccess:sources-changed", onSourcesChanged);
    window.addEventListener(CATALOG_DATA_CHANGED_EVENT, onSourcesChanged);
    return () => {
      window.removeEventListener("gameaccess:sources-changed", onSourcesChanged);
      window.removeEventListener(CATALOG_DATA_CHANGED_EVENT, onSourcesChanged);
    };
  }, []);

  // Every query parameter takes part, so a new filter can never be silently ignored.
  const { debounceMs: _debounce, enabled: _enabled, ...queryOptions } = options;
  const paramsJson = JSON.stringify({ ...queryOptions, limit, offset });
  const paramsKey = useMemo(() => JSON.stringify({ paramsJson, enabled, refreshTick }), [paramsJson, enabled, refreshTick]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const reqId = ++reqIdRef.current;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const params = JSON.parse(paramsJson) as CatalogQueryParams;

        const result = await queryCatalogCache(params);
        if (reqIdRef.current !== reqId) return;

        setItems(result.items);
        setTotal(result.total);
        setError(null);
      } catch (err) {
        if (reqIdRef.current !== reqId) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (reqIdRef.current === reqId) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [paramsKey, debounceMs, enabled]);

  const capped = isCatalogCapped(total, items.length);

  return {
    items,
    total,
    capped,
    loading,
    error,
    refresh,
  };
}
