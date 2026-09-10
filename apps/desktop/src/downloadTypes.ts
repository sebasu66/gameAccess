import type { SteamDownloadStatus } from "./native";

export type ManagedDownloadState =
  | SteamDownloadStatus["state"]
  | "queued"
  | "recovering"
  | "pausing"
  | "cancelling"
  | "cancelled";

export type ManagedDownloadStatus = Omit<SteamDownloadStatus, "state"> & {
  state: ManagedDownloadState;
  job_id?: string | null;
  worker_pid?: number | null;
  library_index?: number | null;
  queued_at_ms?: number | null;
};

export function managedDownloadStatus(status: SteamDownloadStatus): ManagedDownloadStatus {
  return status as ManagedDownloadStatus;
}
