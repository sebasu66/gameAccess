import { invoke } from "@tauri-apps/api/core";
import { getApiBaseUrl } from "./settings";

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

async function activationUrl(path: string): Promise<string> {
  const base = await getApiBaseUrl();
  if (!base) throw new Error("No se pudo conectar con el servidor de Game Access.");
  return `${base}${path}`;
}

export async function checkActivation(token: string): Promise<ActivationStatus> {
  const id = await getInstallationId();
  const response = await fetch(await activationUrl("/activation/status"), {
    headers: { Authorization: `Bearer ${token}`, "X-GameAccess-Installation": id },
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("La activación venció o fue revocada.");
    throw new Error("No pudimos verificar la activación con el servidor.");
  }
  sessionToken = token;
  return response.json() as Promise<ActivationStatus>;
}

export async function redeemActivation(key: string): Promise<ActivationStatus> {
  const id = await getInstallationId();
  const response = await fetch(await activationUrl("/activation/redeem"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: key.trim(), installation_id: id }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail || "No se pudo activar esta instalación.");
  }
  const result = await response.json() as { session_token: string; expires_at: string };
  await saveActivationSession(result.session_token);
  return checkActivation(result.session_token);
}
