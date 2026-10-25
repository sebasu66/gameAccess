import { digitalProcessManager, type LibraryGame, type SteamOwner } from "./catalog/DigitalProcessManager";
import { libraryMembership } from "./libraryMembership";
import { scanLibrary } from "./libraryScan";
import { getApiBaseUrl } from "./settings";
import type { CatalogGame } from "./types";

/** What the Steam Account Manager (apps/launcher/steam_account_manager) reports about the local Steam client. */
export interface SteamAccountInfo { steam_id64: string; account_id: number; account_name: string; persona_name: string; remembered: boolean; active: boolean; owned_count: number; installed_count: number; private: boolean; error: string }
export interface SteamSettings { auto_import: boolean; switch_accounts: boolean }
export interface SteamStatus { found: boolean; path: string; active_id64: string; accounts: SteamAccountInfo[]; libraries: string[]; installed_count: number; owned_count: number; owned_fetched_at: number; settings: SteamSettings }
interface SyncedGame { app_id: number; name: string; owner_name?: string }
export interface SteamSyncResult { found: boolean; skipped?: boolean; linked: SyncedGame[]; owned: SyncedGame[] }

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function steamStatus(): Promise<SteamStatus | null> {
  if (!hasTauriRuntime()) return null;
  return (await digitalProcessManager.steamStatus() as unknown as { steam: SteamStatus }).steam;
}

export async function saveSteamSettings(values: Partial<SteamSettings>): Promise<SteamSettings> {
  return (await digitalProcessManager.steamSaveSettings(values) as unknown as { settings: SteamSettings }).settings;
}

/** A Steam game owned by one of the user's accounts and not installed: Steam installs it, never Game Access's sources. */
export const isSteamOwned = (entry?: LibraryGame) => Boolean(entry && entry.link_kind === "steam" && entry.state === "steam_owned");
export const steamOwnerLabel = (owner?: SteamOwner) => owner ? (owner.persona && owner.persona !== owner.account ? `${owner.persona} (${owner.account})` : owner.account || owner.persona || owner.id64) : "";

export function installThroughSteam(game: { app_id?: number | null; id: number; name: string }) {
  return digitalProcessManager.steamInstall(game.app_id ?? game.id, game.name);
}

/**
 * Bring the Steam library into Game Access: installed games are linked by the launcher, and they and the owned ones
 * not installed join the library list. The catalog entry is used when there is one (its cover and data); otherwise
 * a light record, so thousands of owned games do not fill the browser storage.
 */
export async function syncSteamLibrary(catalog: CatalogGame[] = [], options: { refresh?: boolean; auto?: boolean } = {}): Promise<SteamSyncResult> {
  // The owned games come from the GameAccess server, which holds the Steam Web API key (the user never needs one).
  const api = await getApiBaseUrl().catch(() => "");
  const result = await digitalProcessManager.steamSync(Boolean(options.refresh), Boolean(options.auto), api) as unknown as SteamSyncResult;
  if (result.skipped || !result.found) return result;
  const byId = new Map(catalog.map(game => [game.app_id ?? game.id, game]));
  const games = [...result.linked, ...result.owned].map(item => byId.get(item.app_id) ?? ({ id: item.app_id, app_id: item.app_id, name: item.name || `Steam ${item.app_id}` } as CatalogGame));
  try { libraryMembership.addMany(games); } catch { /* the library is busy: the next sync adds them */ }
  await scanLibrary();
  return result;
}

let startupSync: Promise<SteamSyncResult | null> | null = null;
/** Once per app start, unless the user turned the automatic Steam import off in Settings › Steam. */
export function syncSteamOnStartup(catalog: CatalogGame[] = []): Promise<SteamSyncResult | null> {
  if (!hasTauriRuntime()) return Promise.resolve(null);
  startupSync ??= syncSteamLibrary(catalog, { auto: true }).catch(() => null);
  return startupSync;
}
