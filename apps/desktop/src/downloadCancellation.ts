import { invoke } from "@tauri-apps/api/core";

import { getCatalogMode } from "./catalogMode";
import { openSteamClient, type SteamDownloadStatus } from "./native";

export interface CancelResult {
  supported: boolean;
  status: SteamDownloadStatus | null;
  message?: string;
}

export async function cancelManagedDownload(appId: number, jobId?: string | null): Promise<CancelResult> {
  if (!appId) throw new Error("AppID inválido");
  if (getCatalogMode() !== "gameaccess") {
    await openSteamClient();
    return {
      supported: false,
      status: null,
      message: "Steam administra esta descarga. GameAccess abrió Steam porque todavía no hay una API verificada para cancelarla sin intervenir el cliente.",
    };
  }
  if (!jobId) throw new Error("La descarga administrada no tiene un jobId verificable.");
  const status = await invoke<SteamDownloadStatus>("cancel_provider_download", { appId, jobId });
  return { supported: true, status };
}
