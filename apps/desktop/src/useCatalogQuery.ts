import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { queryCatalogCache, type CatalogQueryParams } from "./catalogCache";
import type { CatalogGame } from "./types";

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

  const paramsKey = useMemo(() => JSON.stringify({
    query: options.query,
    genres: options.genres,
    features: options.features,
    sources: options.sources,
    has_downloads: options.has_downloads,
    language: options.language,
    sort_by: options.sort_by,
    sort_direction: options.sort_direction,
    limit,
    offset,
    min_rating: options.min_rating,
    max_age_days: options.max_age_days,
    include_recent_unrated: options.include_recent_unrated,
    app_ids: options.app_ids,
    enabled,
    refreshTick,
  }), [
    options.query,
    options.genres,
    options.features,
    options.sources,
    options.has_downloads,
    options.language,
    options.sort_by,
    options.sort_direction,
    limit,
    offset,
    options.min_rating,
    options.max_age_days,
    options.include_recent_unrated,
    options.app_ids,
    enabled,
    refreshTick,
  ]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const reqId = ++reqIdRef.current;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const params: CatalogQueryParams = {
          query: options.query,
          genres: options.genres,
          features: options.features,
          sources: options.sources,
          has_downloads: options.has_downloads,
          language: options.language,
          sort_by: options.sort_by,
          sort_direction: options.sort_direction,
          limit,
          offset,
          min_rating: options.min_rating,
          max_age_days: options.max_age_days,
          include_recent_unrated: options.include_recent_unrated,
          app_ids: options.app_ids,
        };

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
