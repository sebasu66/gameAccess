import { invoke } from "@tauri-apps/api/core";
import { getApiBaseUrl } from "./settings";
import { boundedFetch } from "./settings";
import { translate, translateServerDetail } from "./i18n";

export const ACTIVATION_INVALID_EVENT = "gameaccess:activation-invalid";

const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let installationId = "";
let sessionToken = "";
const REGULAR_CACHE = "gameaccess:regular-access";
export const ACTIVATION_CHANGED_EVENT = "gameaccess:activation-changed";
export type AccessTier = "base" | "plus";
export interface RegularAccess { key: string | null; expires_at: string; access_tier: AccessTier; }
let activationTier: AccessTier | null = null;
export function getActivationTier(): AccessTier | null { return activationTier; }
let currentAccess: RegularAccess | null = null;
export function getRegularAccess(): RegularAccess | null { return currentAccess; }
function publishAccess(access: RegularAccess | null): void {
  currentAccess = access;
  window.dispatchEvent(new Event(ACTIVATION_CHANGED_EVENT));
}
function browserCache(): { session_token?: string; key?: string } {
  try {
    const value = JSON.parse(localStorage.getItem(REGULAR_CACHE) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}
async function cachedKey(): Promise<string | null> {
  return native() ? invoke<string | null>("activation_read_key") : browserCache().key || null;
}

export async function getInstallationId(): Promise<string> {
  if (installationId) return installationId;
  if (native()) installationId = await invoke<string>("activation_installation_id");
  else {
    const stored = localStorage.getItem("gameaccess:installation-id");
    installationId = stored || crypto.randomUUID();
    if (!stored) localStorage.setItem("gameaccess:installation-id", installationId);
  }
  return installationId;
}

export async function readActivationSession(): Promise<string | null> {
  return sessionToken || (native() ? invoke<string | null>("activation_read_session") : browserCache().session_token || null);
}

export async function saveActivationSession(token: string, persistent = false, key: string | null = null): Promise<void> {
  if (native()) await invoke("activation_save_session", { sessionToken: token, persistent, accessKey: persistent ? key : null });
  else if (persistent) localStorage.setItem(REGULAR_CACHE, JSON.stringify({ session_token: token, key }));
  else localStorage.removeItem(REGULAR_CACHE);
  sessionToken = token;
}

export async function clearActivationSession(): Promise<void> {
  sessionToken = "";
  activationTier = null;
  if (native()) await invoke("activation_clear_session");
  localStorage.removeItem(REGULAR_CACHE);
  publishAccess(null);
}

export function activationHeaders(): Record<string, string> {
  return sessionToken && installationId
    ? { Authorization: `Bearer ${sessionToken}`, "X-GameAccess-Installation": installationId }
    : {};
}

export function invalidateActivation(): void {
  sessionToken = "";
  activationTier = null;
  publishAccess(null);
  window.dispatchEvent(new Event(ACTIVATION_INVALID_EVENT));
}

export interface ActivationStatus {
  active: boolean;
  expires_at: string;
  server_time: string;
  cacheable?: boolean;
  access_tier?: AccessTier;
}

export interface ActivationEnd {
  reason: "expired" | "revoked" | "unavailable";
  expires_at?: string;
  revoked_at?: string;
}
const LAST_STATUS = "gameaccess:last-activation-status";
export function lastActivationEnd(): ActivationEnd {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_STATUS) || "{}") as Partial<ActivationStatus>;
    const expiry = value.expires_at && Number.isFinite(Date.parse(value.expires_at)) ? value.expires_at : undefined;
    return { reason: expiry && Date.parse(expiry) <= Date.now() ? "expired" : "unavailable", expires_at: expiry };
  } catch { return { reason: "unavailable" }; }
}
export class ActivationRejectedError extends Error {
  constructor(public end: ActivationEnd) { super(translate("activationExpired")); }
}
function rememberStatus(status: ActivationStatus) {
  try {
    if (status.cacheable === true) localStorage.setItem(LAST_STATUS, JSON.stringify({ expires_at: status.expires_at }));
    else localStorage.removeItem(LAST_STATUS);
  } catch { /* Optional display metadata only. */ }
}

export class ActivationConnectionError extends Error {
  constructor() { super(translate("activationNoServer")); }
}
async function activationFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try { return await boundedFetch(fetch, signal)(url, init); }
  catch { throw new ActivationConnectionError(); }
}

async function activationUrl(path: string): Promise<string> {
  const base = await getApiBaseUrl();
  if (!base) throw new ActivationConnectionError();
  return `${base}${path}`;
}

export async function checkActivation(token: string, signal?: AbortSignal, baseUrl?: string): Promise<ActivationStatus> {
  const id = await getInstallationId();
  const response = await activationFetch(baseUrl ? `${baseUrl}/activation/status` : await activationUrl("/activation/status"), {
    headers: { Authorization: `Bearer ${token}`, "X-GameAccess-Installation": id },
    cache: "no-store",
  }, signal);
  if (!response.ok) {
    if (response.status === 401) {
      const body = await response.json().catch(() => ({})) as { detail?: Partial<ActivationEnd> };
      const detail = body.detail;
      const fallback = lastActivationEnd();
      const end = detail && typeof detail === "object"
        ? { reason: detail.reason === "expired" || detail.reason === "revoked" ? detail.reason : fallback.reason,
            expires_at: detail.expires_at || fallback.expires_at, revoked_at: detail.revoked_at } as ActivationEnd
        : fallback;
      await clearActivationSession();
      throw new ActivationRejectedError(end);
    }
    throw new ActivationConnectionError();
  }
  const status = await response.json() as ActivationStatus;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  activationTier = status.access_tier === "plus" ? "plus" : "base";
  if (status.cacheable !== true) {
    await saveActivationSession(token, false);
    publishAccess(null);
  } else {
    const key = await cachedKey();
    sessionToken = token;
    publishAccess({ key, expires_at: status.expires_at, access_tier: activationTier });
  }
  rememberStatus(status);
  return status;
}

export async function redeemActivation(key: string): Promise<ActivationStatus> {
  const id = await getInstallationId();
  const response = await activationFetch(await activationUrl("/activation/redeem"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: key.trim(), installation_id: id }),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status >= 500 || response.status === 408 || response.status === 429) throw new ActivationConnectionError();
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail ? translateServerDetail(body.detail) : translate("activationGenericFailed"));
  }
  const result = await response.json() as { session_token: string; expires_at: string; cacheable?: boolean };
  const status = await checkActivation(result.session_token);
  const persistent = result.cacheable === true && status.cacheable === true;
  await saveActivationSession(result.session_token, persistent, persistent ? key.trim() : null);
  publishAccess(persistent ? { key: key.trim(), expires_at: status.expires_at, access_tier: activationTier || "base" } : null);
  return status;
}
