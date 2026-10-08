import { invoke } from "@tauri-apps/api/core";
import { getApiBaseUrl } from "./settings";
import { boundedFetch } from "./settings";
import { translate, translateServerDetail } from "./i18n";

export const ACTIVATION_INVALID_EVENT = "gameaccess:activation-invalid";

const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let installationId = "";
let sessionToken = "";
let browserToken = "";

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
  return native() ? invoke<string | null>("activation_read_session") : browserToken || null;
}

export async function saveActivationSession(token: string): Promise<void> {
  if (native()) await invoke("activation_save_session", { sessionToken: token });
  else browserToken = token;
  sessionToken = token;
}

export async function clearActivationSession(): Promise<void> {
  sessionToken = "";
  if (native()) await invoke("activation_clear_session");
  else browserToken = "";
}

export function activationHeaders(): Record<string, string> {
  return sessionToken && installationId
    ? { Authorization: `Bearer ${sessionToken}`, "X-GameAccess-Installation": installationId }
    : {};
}

export function invalidateActivation(): void {
  sessionToken = "";
  window.dispatchEvent(new Event(ACTIVATION_INVALID_EVENT));
}

export interface ActivationStatus {
  active: boolean;
  expires_at: string;
  server_time: string;
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
  try { localStorage.setItem(LAST_STATUS, JSON.stringify({ expires_at: status.expires_at })); } catch { /* Optional display metadata only; never stores a key/token. */ }
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
      throw new ActivationRejectedError(end);
    }
    throw new ActivationConnectionError();
  }
  const status = await response.json() as ActivationStatus;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  sessionToken = token;
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
  const result = await response.json() as { session_token: string; expires_at: string };
  await saveActivationSession(result.session_token);
  return checkActivation(result.session_token);
}
