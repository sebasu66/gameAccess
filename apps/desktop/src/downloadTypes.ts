import type { SteamDownloadStatus } from "./native";

export type ManagedDownloadState = SteamDownloadStatus["state"] | "cancelling" | "cancelled";

export type ManagedDownloadStatus = Omit<SteamDownloadStatus, "state"> & {
  state: ManagedDownloadState;
  job_id?: string | null;
  worker_pid?: number | null;
};

export function managedDownloadStatus(status: SteamDownloadStatus): ManagedDownloadStatus {
  return status as ManagedDownloadStatus;
}
