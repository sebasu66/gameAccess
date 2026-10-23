import { invoke } from "@tauri-apps/api/core";
import { resourceGuard } from "./ResourceGuard";
import type { CoverTier } from "./coverSize";

const requests = new Map<string, Promise<string | null>>();
const memoryCache = new Map<string, string>();
const MAX_CONCURRENT = 6;
let activeCount = 0;
const waitQueue: Array<() => void> = [];

// Waiting requests are served newest first: after a fast scroll the cards on screen are the
// newest ones, and the covers of rows already scrolled past must not hold them up.
function acquireSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const entry = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
    const onAbort = () => {
      const at = waitQueue.indexOf(entry);
      if (at >= 0) waitQueue.splice(at, 1);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    waitQueue.push(entry);
  });
}

function releaseSlot(): void {
  activeCount--;
  const next = waitQueue.pop();
  if (next) {
    activeCount++;
    next();
  }
}

async function runWithSlot<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await acquireSlot(signal);
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
// `signal` drops the request while it still waits for a slot (a card that left the window before its turn).
export function resolveLibraryCover(appId: number, tier: CoverTier = "2x", signal?: AbortSignal): Promise<string | null> {
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
  }, signal);
  requests.set(key, request);
  const forget = () => { requests.delete(key); };
  void request.then(forget, forget);
  return request;
}
