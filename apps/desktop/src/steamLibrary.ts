import { digitalProcessManager, type LibraryGame, type SteamOwner } from "./catalog/DigitalProcessManager";
import { libraryMembership } from "./libraryMembership";
import { libraryScanState, scanLibrary } from "./libraryScan";
import { getApiBaseUrl } from "./settings";
import type { CatalogGame } from "./types";

/** What the Steam Account Manager (apps/launcher/steam_account_manager) reports about the local Steam client. */
export interface SteamAccountInfo { steam_id64: string; account_id: number; account_name: string; persona_name: string; remembered: boolean; active: boolean; owned_count: number; installed_count: number; private: boolean; error: string }
export interface SteamSettings { auto_import: boolean; switch_accounts: boolean }
/** An account this PC's Steam remembers that is not registered yet: offered to sign in and add, never added alone. */
export interface SteamSuggestion { steam_id64: string; account_name: string; persona_name: string }
export interface SteamStatus { found: boolean; path: string; active_id64: string; accounts: SteamAccountInfo[]; suggestions?: SteamSuggestion[]; libraries: string[]; installed_count: number; owned_count: number; owned_fetched_at: number; settings: SteamSettings }
interface SyncedGame { app_id: number; name: string; owner_name?: string }
/** `games`: every game of the registered accounts' libraries now (account_registry.py, steam_account_manager). */
export interface SteamSyncResult { found: boolean; skipped?: boolean; linked: SyncedGame[]; owned: SyncedGame[]; removed?: number[]; games?: number[] }

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function steamStatus(): Promise<SteamStatus | null> {
  if (!hasTauriRuntime()) return null;
  return (await digitalProcessManager.steamStatus() as unknown as { steam: SteamStatus }).steam;
}

export async function saveSteamSettings(values: Partial<SteamSettings>): Promise<SteamSettings> {
  return (await digitalProcessManager.steamSaveSettings(values) as unknown as { settings: SteamSettings }).settings;
}

export type SteamLinkStatus = "pending" | "done" | "cancelled" | "failed" | "expired";
const LINK_POLL_MS = 2500;

/**
 * Register a Steam account: the launcher opens Steam's own sign-in page in the browser (through the GameAccess server,
 * apps/api/app/steam_link_routes.py); this waits until the user signed in there, cancelled, or the link expired. Game
 * Access never sees a password. When it is done, the account's whole library is in (the launcher syncs it at once).
 */
export async function linkSteamAccount(options: { signal?: AbortSignal; wait?: (ms: number) => Promise<void> } = {}): Promise<SteamLinkStatus> {
  const api = await getApiBaseUrl();
  const started = await digitalProcessManager.steamLinkStart(api) as unknown as { state: string; expires_in: number };
  const wait = options.wait ?? (ms => new Promise<void>(done => window.setTimeout(done, ms)));
  const until = Date.now() + (started.expires_in || 600) * 1000;
  while (Date.now() < until) {
    await wait(LINK_POLL_MS);
    if (options.signal?.aborted) return "cancelled";
    const answer = await digitalProcessManager.steamLinkPoll(api, started.state) as unknown as { status: SteamLinkStatus };
    if (answer.status !== "pending") {
      if (answer.status === "done") await syncSteamLibrary([], {});
      return answer.status;
    }
  }
  return "expired";
}

/** The account's whole library leaves Game Access: Steam and the games on disk are not touched. */
export async function removeSteamAccount(accountId: string): Promise<void> {
  await digitalProcessManager.steamAccountRemove(accountId);
  await syncSteamLibrary([], {});
}

/** A Steam game owned by one of the user's accounts and not installed: Steam installs it, never Game Access's sources. */
export const isSteamOwned = (entry?: LibraryGame) => Boolean(entry && entry.link_kind === "steam" && entry.state === "steam_owned");
export const steamOwnerLabel = (owner?: SteamOwner) => owner ? (owner.persona && owner.persona !== owner.account ? `${owner.persona} (${owner.account})` : owner.account || owner.persona || owner.id64) : "";


/** The Steam games the last sync put in the library list: the next one takes out those that left the accounts. */
export const STEAM_MEMBERS_KEY = "gameaccess.steam.members.v1";
function readSteamMembers(): number[] {
  try { const saved = JSON.parse(localStorage.getItem(STEAM_MEMBERS_KEY) || "[]"); return Array.isArray(saved) ? saved.filter(Number.isInteger) : []; } catch { return []; }
}
function writeSteamMembers(ids: number[]) {
  try { localStorage.setItem(STEAM_MEMBERS_KEY, JSON.stringify(ids)); } catch { /* storage full or blocked: the next sync tries again */ }
}

/**
 * Keep the registered Steam accounts' libraries in the library list, whole: their games come in (the catalog entry
 * when there is one, for its cover and data; otherwise a light record, so thousands of owned games do not fill the
 * browser storage), and the ones that left (an account removed, a game no longer owned) go, unless Game Access has
 * its own copy of that game.
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
  if (result.games) {
    const now = new Set(result.games);
    // A game of Game Access's own library (downloaded, imported, linked from a folder) stays whatever Steam says.
    const own = new Set(libraryScanState().games.filter(entry => entry.app_id != null && entry.link_kind !== "steam").map(entry => entry.app_id as number));
    // The first sync after the update has no list yet: the games whose Steam record it just removed count as well.
    const gone = [...new Set([...readSteamMembers(), ...(result.removed ?? [])])].filter(id => !now.has(id) && !own.has(id));
    try {
      for (const id of gone) libraryMembership.remove({ id, app_id: id, name: "" } as CatalogGame);
      writeSteamMembers([...now]);
    } catch { /* the library is busy: the next sync takes them out */ }
  }
  return result;
}

let startupSync: Promise<SteamSyncResult | null> | null = null;
/** Once per app start: the registered accounts' libraries are always kept in step. */
export function syncSteamOnStartup(catalog: CatalogGame[] = []): Promise<SteamSyncResult | null> {
  if (!hasTauriRuntime()) return Promise.resolve(null);
  startupSync ??= syncSteamLibrary(catalog, { auto: true }).catch(() => null);
  return startupSync;
}

const SYNC_NOW = "ga:steam-sync-now";
export const STEAM_SYNC_EVERY_MS = 10 * 60_000;   // a game bought, installed or removed in Steam shows up within minutes
export const STEAM_SYNC_FOCUS_GAP_MS = 2 * 60_000; // coming back to the app looks again, but not on every alt-tab

/** Ask the running sync to look at Steam now (the import was just turned on, a free game was handed to Steam). */
export function requestSteamSync() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_NOW));
}

/**
 * Keeps the registered Steam accounts' libraries in step with Game Access while the app is open: every few minutes,
 * when the app gets the focus back, and at once when asked. One sync at a time.
 */
export function startSteamSync(options: { getCatalog?: () => CatalogGame[]; sync?: (catalog: CatalogGame[]) => Promise<unknown>; now?: () => number } = {}): () => void {
  if (typeof window === "undefined") return () => undefined;
  const sync = options.sync ?? (hasTauriRuntime() ? (catalog: CatalogGame[]) => syncSteamLibrary(catalog, { auto: true }) : null);
  if (!sync) return () => undefined;
  const now = options.now ?? Date.now;
  let busy = false;
  let last = now();
  const run = async () => {
    if (busy) return;
    busy = true;
    last = now();
    try { await sync(options.getCatalog?.() ?? []); } catch { /* the next look tries again */ } finally { busy = false; }
  };
  const onFocus = () => { if (now() - last >= STEAM_SYNC_FOCUS_GAP_MS) void run(); };
  const onAsk = () => void run();
  const timer = window.setInterval(() => void run(), STEAM_SYNC_EVERY_MS);
  window.addEventListener("focus", onFocus);
  window.addEventListener(SYNC_NOW, onAsk);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener(SYNC_NOW, onAsk); };
}
