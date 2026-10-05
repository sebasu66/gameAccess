import { invoke } from "@tauri-apps/api/core";
import { getInstallationId, readActivationSession } from "../activation";
import { getApiBaseUrl } from "../settings";

export async function supplyArchivePasswords(appId: number): Promise<void> {
  try {
    const [api, token, installation] = await Promise.all([getApiBaseUrl(), readActivationSession(), getInstallationId()]);
    if (!api || !token) throw new Error("No hay una sesión activa para solicitar las contraseñas al servidor.");
    const response = await fetch(`${api}/digital/archive-passwords`, {
      cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, "X-GameAccess-Installation": installation },
    });
    if (!response.ok) throw new Error(`El servidor no pudo entregar las contraseñas (HTTP ${response.status}).`);
    const result = await response.json() as { passwords: unknown };
    if (!Array.isArray(result.passwords) || result.passwords.some(value => typeof value !== "string")) throw new Error("La lista de contraseñas del servidor es inválida.");
    await invoke("supply_digital_archive_passwords", { appId, passwords: result.passwords, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await invoke("supply_digital_archive_passwords", { appId, passwords: [], error: message });
    throw error;
  }
}
