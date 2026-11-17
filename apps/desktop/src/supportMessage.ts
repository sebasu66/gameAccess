import { invoke } from "@tauri-apps/api/core";
import { getInstallationId } from "./activation";
import { hasTauriRuntime } from "./native";
import { narrate, sanitizedRemoteError } from "./narrationLog";
import { getApiBaseUrl } from "./settings";

declare const __BUILD_TIMESTAMP__: string;

export type SupportMessage = { subject: string; message: string; email: string; language: string; attachLog: boolean };
export type SupportResult = "sent" | "offline" | "too_many" | "invalid_email" | "failed";

// The end of the activity log is what helps to see a problem; more would only make the mail long.
const LOG_LINES = 200;

/** The app's recent activity (the same lines as the activity console), without links, keys or the Windows user. */
export async function recentLog(): Promise<string> {
  if (!hasTauriRuntime()) return "";
  try {
    const lines = await invoke<string[]>("read_activity_console");
    return lines.slice(-LOG_LINES).map(line => sanitizedRemoteError(line).slice(0, 400)).join("\n").slice(-20000);
  } catch {
    return "";
  }
}

/** Sends a contact message to the server (vault/Tareas.md L2); BASE players too, no key needed. */
export async function sendSupportMessage(form: SupportMessage, fetcher: typeof fetch = fetch): Promise<SupportResult> {
  try {
    const [api, installationId, log] = await Promise.all([getApiBaseUrl(), getInstallationId(), form.attachLog ? recentLog() : Promise.resolve("")]);
    if (!api || !installationId) return "offline";
    const response = await fetcher(`${api}/support/messages`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "X-GameAccess-Installation": installationId },
      body: JSON.stringify({
        subject: form.subject.trim(), message: form.message.trim(), email: form.email.trim(), language: form.language, log,
        client_build: typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "development",
      }),
    });
    void narrate(`Contact message sent to the server: HTTP ${response.status}.`, { area: "SUPPORT" });
    if (response.ok) return "sent";
    if (response.status === 429) return "too_many";
    if (response.status === 422) {
      const detail = await response.json().then(body => String(body?.detail ?? "")).catch(() => "");
      if (detail === "invalid_email") return "invalid_email";
    }
    return "failed";
  } catch (error) {
    void narrate(`Contact message could not be sent: ${error instanceof Error ? error.message : String(error)}.`, { area: "SUPPORT", level: "WARN" });
    return "offline";
  }
}
