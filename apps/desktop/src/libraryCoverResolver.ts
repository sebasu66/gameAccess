import { invoke } from "@tauri-apps/api/core";

const requests = new Map<number, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();
const cacheKey = (appId: number) => `gameaccess:portrait:${appId}`;

export function cachedLibraryCover(appId?: number | null): string | null {
  if (!appId || typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(appId)) || "null");
    return value && Date.now() - value.savedAt < 7 * 86400000 && typeof value.url === "string" && value.url.startsWith("https://shared.akamai.steamstatic.com/store_item_assets/") ? value.url : null;
  } catch { return null; }
}

// Only exhausted, visible image loads reach this queue. No catalog detail prefetch.
export function resolveLibraryCover(appId: number): Promise<string | null> {
  const cached = cachedLibraryCover(appId);
  if (cached) return Promise.resolve(cached);
  const existing = requests.get(appId);
  if (existing) return existing;
  const request = queue.then(async () => {
    if (!("__TAURI_INTERNALS__" in window)) return null;
    try {
      const url = await invoke<string | null>("steam_library_cover", { appId });
      if (url) {
        try { localStorage.setItem(cacheKey(appId), JSON.stringify({ url, savedAt: Date.now() })); } catch { /* memory cache still works */ }
      }
      return url;
    } catch { return null; }
  });
  queue = request;
  requests.set(appId, request);
  return request;
}
