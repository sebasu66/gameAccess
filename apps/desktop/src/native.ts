import { invoke } from "@tauri-apps/api/core";
import { InstalledGameStatus } from "./catalog/InstalledGameStatus";
import { narrate } from "./narrationLog";
export const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const LOCAL_BRIDGE = (import.meta.env.VITE_GAMEACCESS_LOCAL_BRIDGE ?? "http://127.0.0.1:1431").replace(/\/$/, "");

async function bridgeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LOCAL_BRIDGE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep the HTTP status when the bridge did not return JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface SteamDownloadStatus {
  app_id: number;
  state: "not-installed" | "requested" | "preparing" | "downloading" | "decompressing" | "extracting" | "installing" | "paused" | "cancelling" | "cancelled" | "interrupted" | "prepared" | "installed" | "freezing" | "frozen" | "thawing" | "unknown";
  progress: number | null;
  bytes_downloaded: number | null;
  bytes_total: number | null;
  speed_bps?: number | null;
  eta_seconds?: number | null;
  installed: boolean;
  provider_id?: string | null;
  prepared_target?: string | null;
  library_index?: number | null;
  error?: string | null;
  job_id?: string | null;
  worker_pid?: number | null;
}

export interface SteamLibraryFolder {
  index: number;
  path: string;
  label: string;
}

export interface MachineProfile {
  memory_gb: number | null;
  cpu: string | null;
  gpus: string[];
}

export interface RuntimePrerequisites {
  runtime_ok: boolean;
  steam_installed: boolean;
  steam_path: string | null;
  account_file_present: boolean;
  remembered_accounts: number;
}

export interface VisualDebugConfig {
  enabled: boolean;
  session_dir: string | null;
}

export async function getVisualDebugConfig(): Promise<VisualDebugConfig> {
  if (!hasTauriRuntime()) return { enabled: false, session_dir: null };
  return invoke<VisualDebugConfig>("visual_debug_config");
}

export async function captureVisualDebug(label: string): Promise<string> {
  if (!hasTauriRuntime()) throw new Error("Visual debug capture requires the desktop app.");
  return invoke<string>("capture_visual_debug", { label });
}

export async function finishVisualDebug(results: unknown): Promise<string> {
  if (!hasTauriRuntime()) throw new Error("Visual debug capture requires the desktop app.");
  return invoke<string>("finish_visual_debug", { results });
}

export async function setVisualDebugViewport(mode: "medium" | "maximized"): Promise<void> {
  if (!hasTauriRuntime()) throw new Error("Visual debug viewport control requires the desktop app.");
  await invoke("set_visual_debug_viewport", { mode });
}


export async function openSteamRun(appId: number): Promise<void> {
  if (!appId) throw new Error("Steam AppID inválido.");
  await narrate(`Launching installed Steam game: app_id=${appId}.`, {area:"LAUNCH"});
  if (hasTauriRuntime()) await invoke("open_steam_run", {appId});
  else window.location.href = `steam://rungameid/${appId}`;
}
export async function openSteamClientInstall(appId: number): Promise<void> {
  if (hasTauriRuntime()) await invoke("open_steam_install", {appId});
  else window.location.href = `steam://install/${appId}`;
}
export async function steamInstalled(): Promise<boolean> {
  if (hasTauriRuntime()) return invoke<boolean>("steam_installed");
  try { return await bridgeRequest<boolean>("/steam-installed"); }
  catch { return true; }
}

async function loadInstalledAppIdsRaw(): Promise<number[]> {
  if (!hasTauriRuntime()) return [];
  try { return await invoke<number[]>("installed_app_ids"); }
  catch { return []; }
}

const installedGameStatus = new InstalledGameStatus(loadInstalledAppIdsRaw);

export async function steamInstalledAppIds(): Promise<number[]> {
  return installedGameStatus.load();
}

export async function getRuntimePrerequisites(): Promise<RuntimePrerequisites> {
  if (hasTauriRuntime()) return invoke<RuntimePrerequisites>("runtime_prerequisites");
  try { return await bridgeRequest<RuntimePrerequisites>("/runtime-prerequisites"); }
  catch { return { runtime_ok: true, steam_installed: true, steam_path: null, account_file_present: true, remembered_accounts: 1 }; }
}

export async function openSteamClient(): Promise<void> {
  if (hasTauriRuntime()) {
    await invoke("open_steam_client");
    return;
  }
  await bridgeRequest("/open-steam-client", { method: "POST" });
}


export async function steamDownloadStatus(appId: number): Promise<SteamDownloadStatus> {
  if (hasTauriRuntime()) return invoke<SteamDownloadStatus>("steam_download_status", {appId});
  return {app_id:appId, state:"not-installed", progress:null, bytes_downloaded:null, bytes_total:null, installed:false};
}
export async function getMachineProfile(): Promise<MachineProfile | null> {
  if (hasTauriRuntime()) return invoke<MachineProfile>("machine_profile");
  try { return await bridgeRequest<MachineProfile>("/machine-profile"); }
  catch { return null; }
}

const steamStoreMetadataCache = new Map<number, Record<string, unknown>>();
const steamStoreMetadataCachedAt = new Map<number, number>();
const steamStoreMetadataRequests = new Map<number, Promise<Record<string, unknown> | null>>();

export async function getSteamStoreMetadata(appId: number, force = false): Promise<Record<string, unknown> | null> {
  if (!appId) return null;
  const cached = steamStoreMetadataCache.get(appId);
  const ttl = cached?.gameaccess_refresh_warning ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
  if (cached && !force && Date.now() - (steamStoreMetadataCachedAt.get(appId) ?? 0) < ttl) return cached;
  const existing = steamStoreMetadataRequests.get(appId);
  if (existing) return existing;
  const request = (async () => {
    if (hasTauriRuntime()) return invoke<Record<string, unknown>>("steam_store_metadata", { appId, force });
    try { return await bridgeRequest<Record<string, unknown>>(`/steam-store-metadata/${appId}`); }
    catch { return null; }
  })();
  steamStoreMetadataRequests.set(appId, request);
  try {
    const value = await request;
    if (value) {
      steamStoreMetadataCache.set(appId, value);
      steamStoreMetadataCachedAt.set(appId, Date.now());
    }
    return value;
  } finally {
    steamStoreMetadataRequests.delete(appId);
  }
}


