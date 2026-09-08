export interface GameAccessFrontendSettings {
  api_url?: string;
  apiUrl?: string;
  api_url_resolver?: string;
  apiUrlResolver?: string;
}

const SETTINGS_PATH = "/gameaccess.settings.json";
const DEFAULT_LOCAL_API = "http://127.0.0.1:38147";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

async function resolveRuntimeApi(fetcher: Fetcher): Promise<string> {
  const buildOverride = import.meta.env.VITE_GAMEACCESS_API;
  if (buildOverride !== undefined) return normalizeApiBaseUrl(buildOverride) ?? "";
  const settings = await loadSettings(fetcher);
  if (!settings) return DEFAULT_LOCAL_API;
  return resolveApiFromSettings(settings, fetcher);
}

let apiBaseUrlPromise: Promise<string> | null = null;

export function getApiBaseUrl(): Promise<string> {
  apiBaseUrlPromise ??= resolveRuntimeApi(fetch);
  return apiBaseUrlPromise;
}
