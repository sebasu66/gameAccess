import { invoke } from "@tauri-apps/api/core";

export async function loginProviderSteam(leaseId: number, apiBaseUrl: string): Promise<void> {
  if (!Number.isInteger(leaseId) || leaseId <= 0) {
    throw new Error("La reserva de GameAccess no es válida.");
  }
  const base = apiBaseUrl.trim();
  if (!base) {
    throw new Error("El servidor de GameAccess no está configurado.");
  }
  await invoke("login_provider_steam_for_lease", { leaseId, apiBaseUrl: base });
}
