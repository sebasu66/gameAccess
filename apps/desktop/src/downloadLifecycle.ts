import { invoke } from "@tauri-apps/api/core";

export interface DownloadJobRecord {
  app_id: number;
  job_id: string;
  requested_at_ms: number;
  completed_at_ms: number | null;
  acknowledged: boolean;
  cancelled: boolean;
}

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function createDownloadJobId(appId: number): string {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ui-${appId}-${nonce}`;
}

export async function registerDownloadJob(appId: number): Promise<DownloadJobRecord | null> {
  if (!hasTauriRuntime()) return null;
  return invoke<DownloadJobRecord>("register_download_job", { appId, jobId: createDownloadJobId(appId) });
}

export async function recordDownloadCompletion(appId: number): Promise<DownloadJobRecord | null> {
  if (!hasTauriRuntime()) return null;
  return invoke<DownloadJobRecord | null>("record_download_completion", { appId });
}

export async function pendingDownloadCompletions(): Promise<DownloadJobRecord[]> {
  if (!hasTauriRuntime()) return [];
  return invoke<DownloadJobRecord[]>("pending_download_completions");
}

export async function acknowledgeDownloadCompletion(jobId: string): Promise<void> {
  if (!hasTauriRuntime()) return;
  await invoke("acknowledge_download_completion", { jobId });
}

export async function cancelDownloadLifecycle(appId: number): Promise<void> {
  if (!hasTauriRuntime()) return;
  await invoke("cancel_download_lifecycle", { appId });
}
