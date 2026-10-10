import { openSteamClient, type SteamDownloadStatus } from "./native";
export interface CancelResult { supported: boolean; status: SteamDownloadStatus | null; message?: string; }
export async function cancelManagedDownload(appId: number, _jobId?: string | null): Promise<CancelResult> {
  if (!appId) throw new Error("AppID inválido");
  await openSteamClient();
  return { supported: false, status: null,
    message: "Steam administra esta descarga. GameAccess abrió Steam para que puedas cancelarla." };
}
