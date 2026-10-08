export interface GameAccessFrontendSettings {
  api_url?: string;
  apiUrl?: string;
  api_url_resolver?: string;
  apiUrlResolver?: string;
  catalog_manifest_url?: string;
  catalogManifestUrl?: string;
}

export type BackendConnectionKind = "local" | "remote" | "offline";
export interface BackendConnection {
  kind: BackendConnectionKind;
  url: string;
}

const SETTINGS_PATH = "/gameaccess.settings.json";
export const DEFAULT_LOCAL_API = "http://127.0.0.1:38147";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const BACKEND_CACHE_MS = 5000;
const LOCAL_HEALTH_TIMEOUT_MS = 750;
const REMOTE_HEALTH_TIMEOUT_MS = 8000;
const COLD_START_WAIT_MS = 75000;
const COLD_START_RETRY_MS = 2500;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;


// Bound individual network attempts, including settings resolvers. A sleeping
// server is retried by the activation screen without an overall wake-up deadline.
export function boundedFetch(fetcher: Fetcher = fetch, parentSignal?: AbortSignal): Fetcher {
  return async (input, init) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const signals = [parentSignal, init?.signal].filter(Boolean) as AbortSignal[];
    signals.forEach(signal => { if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); });
    const timeout = globalThis.setTimeout(abort, REMOTE_HEALTH_TIMEOUT_MS);
    try { return await fetcher(input, { ...init, signal: controller.signal }); }
    finally {
      globalThis.clearTimeout(timeout);
      signals.forEach(signal => signal.removeEventListener("abort", abort));
    }
  };
}

function allowedUrl(value: unknown, preserveQuery: boolean): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const secure = parsed.protocol === "https:";
    const localHttp = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname.toLocaleLowerCase());
    if (!secure && !localHttp) return null;
    if (parsed.username || parsed.password) return null;
    parsed.hash = "";
    if (!preserveQuery) parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function normalizeApiBaseUrl(value: unknown): string | null {
  return allowedUrl(value, false);
}

function normalizeResolverUrl(value: unknown): string | null {
  return allowedUrl(value, true);
}

function settingValue(settings: GameAccessFrontendSettings, snake: keyof GameAccessFrontendSettings, camel: keyof GameAccessFrontendSettings) {
  return settings[snake] ?? settings[camel];
}

function metaRefreshUrl(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/http-equiv\s*=\s*["']?refresh["']?/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!content) continue;
    const target = content.match(/url\s*=\s*(.+)$/i)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    const normalized = normalizeApiBaseUrl(target);
    if (normalized) return normalized;
  }
  return null;
}

function jsonPointerUrl(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["api_url", "apiUrl", "backend_url", "backendUrl", "url"]) {
      const normalized = normalizeApiBaseUrl(parsed[key]);
      if (normalized) return normalized;
    }
  } catch {
    return null;
  }
  return null;
}

async function resolvePointer(pointerUrl: string, fetcher: Fetcher): Promise<string> {
  try {
    const response = await fetcher(pointerUrl, { cache: "no-store", redirect: "follow" });
    if (!response.ok) return "";
    const text = await response.text();
    const fromJson = jsonPointerUrl(text);
    if (fromJson) return fromJson;
    const fromText = normalizeApiBaseUrl(text.trim());
    if (fromText) return fromText;
    const fromMeta = metaRefreshUrl(text);
    if (fromMeta) return fromMeta;
    if (response.redirected) return normalizeApiBaseUrl(response.url) ?? "";
  } catch {
    return "";
  }
  return "";
}

export async function resolveApiFromSettings(settings: GameAccessFrontendSettings, fetcher: Fetcher = fetch): Promise<string> {
  const directRaw = settingValue(settings, "api_url", "apiUrl");
  const direct = normalizeApiBaseUrl(directRaw);
  if (direct) return direct;

  const pointerRaw = settingValue(settings, "api_url_resolver", "apiUrlResolver");
  const pointer = normalizeResolverUrl(pointerRaw);
  if (pointer) return resolvePointer(pointer, fetcher);

  if (directRaw !== undefined || pointerRaw !== undefined) return "";
  return DEFAULT_LOCAL_API;
}

async function loadSettings(fetcher: Fetcher): Promise<GameAccessFrontendSettings | null> {
  try {
    const response = await fetcher(SETTINGS_PATH, { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json();
    return body && typeof body === "object" ? body as GameAccessFrontendSettings : null;
  } catch {
    return null;
  }
}

export async function backendIsHealthy(
  baseUrl: string,
  fetcher: Fetcher = fetch,
  timeoutMs = REMOTE_HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  const normalized = normalizeApiBaseUrl(baseUrl);
  if (!normalized) return false;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetcher(`${normalized}/health`, {
      cache: "no-store",
      signal: controller?.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    if (timeout != null) globalThis.clearTimeout(timeout);
  }
}

export async function resolveBackendConnectionFromSettings(
  settings: GameAccessFrontendSettings,
  fetcher: Fetcher = fetch,
): Promise<BackendConnection> {
  // Development always wins: if a local backend is alive, never send this
  // desktop session to a hosted GameAccess backend.
  if (await backendIsHealthy(DEFAULT_LOCAL_API, fetcher, LOCAL_HEALTH_TIMEOUT_MS)) {
    return { kind: "local", url: DEFAULT_LOCAL_API };
  }

  const configured = await resolveApiFromSettings(settings, fetcher);
  if (configured && configured !== DEFAULT_LOCAL_API && await backendIsHealthy(configured, fetcher, REMOTE_HEALTH_TIMEOUT_MS)) {
    return { kind: "remote", url: configured };
  }
  return { kind: "offline", url: "" };
}

async function runtimeSettings(fetcher: Fetcher): Promise<GameAccessFrontendSettings> {
  const buildOverride = import.meta.env.VITE_GAMEACCESS_API;
  return buildOverride !== undefined
    ? { api_url: buildOverride }
    : (await loadSettings(fetcher) ?? {});
}

async function resolveRuntimeBackend(fetcher: Fetcher): Promise<BackendConnection> {
  return resolveBackendConnectionFromSettings(await runtimeSettings(fetcher), fetcher);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

async function resolveRuntimeBackendWithColdStart(fetcher: Fetcher): Promise<BackendConnection> {
  const settings = await runtimeSettings(fetcher);

  if (await backendIsHealthy(DEFAULT_LOCAL_API, fetcher, LOCAL_HEALTH_TIMEOUT_MS)) {
    return { kind: "local", url: DEFAULT_LOCAL_API };
  }

  const configured = await resolveApiFromSettings(settings, fetcher);
  if (!configured || configured === DEFAULT_LOCAL_API) return { kind: "offline", url: "" };

  const deadline = Date.now() + COLD_START_WAIT_MS;
  do {
    if (await backendIsHealthy(configured, fetcher, REMOTE_HEALTH_TIMEOUT_MS)) {
      return { kind: "remote", url: configured };
    }
    if (Date.now() >= deadline) break;
    await wait(Math.min(COLD_START_RETRY_MS, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);

  return { kind: "offline", url: "" };
}

let cachedConnection: BackendConnection | null = null;
let cachedAt = 0;
let connectionPromise: Promise<BackendConnection> | null = null;

export function resetBackendConnectionCache(): void {
  cachedConnection = null;
  cachedAt = 0;
  connectionPromise = null;
}

export async function getBackendConnection(forceRefresh = false, signal?: AbortSignal): Promise<BackendConnection> {
  const now = Date.now();
  if (!forceRefresh && cachedConnection && now - cachedAt < BACKEND_CACHE_MS) return cachedConnection;
  if (!forceRefresh && connectionPromise) return connectionPromise;

  if (forceRefresh) {
    const connection = await resolveRuntimeBackend(boundedFetch(fetch, signal));
    cachedConnection = connection;
    cachedAt = Date.now();
    return connection;
  }

  connectionPromise = resolveRuntimeBackendWithColdStart(boundedFetch(fetch, signal)).then((connection) => {
    cachedConnection = connection;
    cachedAt = Date.now();
    return connection;
  }).finally(() => {
    connectionPromise = null;
  });
  return connectionPromise;
}

export async function getApiBaseUrl(): Promise<string> {
  return (await getBackendConnection()).url;
}

export async function getCatalogManifestUrl(fetcher: Fetcher = fetch): Promise<string> {
  const settings = await loadSettings(fetcher);
  if (!settings) return "";
  const raw = settingValue(settings, "catalog_manifest_url", "catalogManifestUrl");
  return normalizeResolverUrl(raw) ?? "";
}
