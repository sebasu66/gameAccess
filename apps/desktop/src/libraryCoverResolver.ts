import { invoke } from "@tauri-apps/api/core";
import { resourceGuard } from "./ResourceGuard";
import type { CoverTier } from "./coverSize";

const requests = new Map<string, Promise<string | null>>();
const memoryCache = new Map<string, string>();
const MAX_CONCURRENT = 6;
let activeCount = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    waitQueue.push(resolve);
  });
}

function releaseSlot(): void {
  activeCount--;
  const next = waitQueue.shift();
  if (next) {
    activeCount++;
    next();
  }
}

async function runWithSlot<T>(task: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await task();
  } finally {
    releaseSlot();
  }
}

// The 2x key keeps the original format so covers cached before size tiers existed stay valid.
const cacheKey = (appId: number, tier: CoverTier) => tier === "2x" ? `gameaccess:portrait:${appId}` : `gameaccess:portrait1x:${appId}`;
const slot = (appId: number, tier: CoverTier) => `${tier}:${appId}`;

export function cachedLibraryCover(appId?: number | null, tier: CoverTier = "2x"): string | null {
  if (!appId) return null;
  const mem = memoryCache.get(slot(appId, tier));
  if (mem) return mem;
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(appId, tier)) || "null");
    const valid = value && Date.now() - value.savedAt < 7 * 86400000 && typeof value.url === "string" && value.url.startsWith("https://shared.akamai.steamstatic.com/store_item_assets/") ? value.url : null;
    if (valid) memoryCache.set(slot(appId, tier), valid);
    return valid;
  } catch { return null; }
}

// Resolves the portrait capsule at the size the grid needs. Visible cards only; no catalog detail prefetch.
export function resolveLibraryCover(appId: number, tier: CoverTier = "2x"): Promise<string | null> {
  const cached = cachedLibraryCover(appId, tier);
  if (cached) return Promise.resolve(cached);
  const key = slot(appId, tier);
  const existing = requests.get(key);
  if (existing) return existing;
  const request = runWithSlot(async () => {
    const releaseTask = resourceGuard.registerAsyncTask(`cover-${key}`, "artwork");
    try {
      if (!("__TAURI_INTERNALS__" in window)) return null;
      try {
        const url = await invoke<string | null>("steam_library_cover", { appId, size: tier });
        if (url) {
          memoryCache.set(key, url);
          try { localStorage.setItem(cacheKey(appId, tier), JSON.stringify({ url, savedAt: Date.now() })); } catch { /* memory cache still works */ }
        }
        return url;
      } catch { return null; }
    } finally {
      releaseTask();
    }
  });
  requests.set(key, request);
  void request.finally(() => requests.delete(key));
  return request;
}
