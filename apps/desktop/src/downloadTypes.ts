import type { SteamDownloadStatus } from "./native";

export type GenericDownloadState =
  | "not-installed"
  | "requested"
  | "preparing"
  | "downloading"
  | "decompressing"
  | "extracting"
  | "installing"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "prepared"
  | "installed"
  | "freezing"
  | "frozen"
  | "thawing"
  | "failed"
  | "error"
  | "unknown";

export type ManagedDownloadState =
  | SteamDownloadStatus["state"]
  | "decompressing"
  | "extracting"
  | "installing"
  | "cancelling"
  | "cancelled";

export interface GenericDownloadStatus {
  app_id?: number;
  state?: ManagedDownloadState | string;
  statusText?: string | null;
  progress?: number | null;
  bytes_downloaded?: number | null;
  bytes_total?: number | null;
  speed_bps?: number | null;
  eta_seconds?: number | null;
  installed?: boolean;
  error?: string | null;
  job_id?: string | null;
  worker_pid?: number | null;
}

export type ManagedDownloadStatus = Omit<SteamDownloadStatus, "state"> & {
  state: ManagedDownloadState;
  statusText?: string | null;
  job_id?: string | null;
  worker_pid?: number | null;
};

export function managedDownloadStatus(status: SteamDownloadStatus): ManagedDownloadStatus {
  return status as ManagedDownloadStatus;
}

