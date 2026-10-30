import { useSyncExternalStore } from "react";
import { narrate } from "./narrationLog";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import type { AppShortcut } from "./appShortcuts";
import { ACTIVATION_CHANGED_EVENT, getActivationTier } from "./activation";
import { setPlusGraceDays, setPlusLapsed } from "./accessRole";

/**
 * Kid mode (vault/Modo niño.md, src-tauri/src/kid_mode.rs). The family file says which Windows accounts are children
 * and what each may play; only an administrator writes it. In the adult's account the kid mode screen and the library
 * manager edit a draft here, and "Apply" sends it to Windows (one permission question). In a child's account the app
 * opens the kid screen instead of the library.
 */
/** `appId`: a library game's Steam AppID, or `-id` for a shortcut to another program (appShortcuts.ts). */
export interface KidGame { appId: number; name: string; folder: string; executable: string; arguments: string[]; steam: boolean;
  /** Most minutes per day for this game, inside the daily limit; 0 or missing: only the daily limit applies. */
  dailyMinutes?: number }
/** One day of the week: most minutes of play (0: no limit) and the hours the child may use the PC, "from" to "to". */
export interface KidDayLimit { minutes: number; from: number; to: number }
export interface Kid { name: string; sid: string; enabled: boolean; dailyMinutes: number; weekdays: string; weekend: string; games: KidGame[];
  /** Each day of the week, Sunday first (as Windows counts them); when present it rules over the fields above. */
  days?: KidDayLimit[] }
export interface Family { version: number; kids: Kid[] }
export interface KidSession { paused?: boolean; kid: Kid; playedSeconds: number; remainingSeconds: number | null; playing: number | null; timeUp: boolean;
  /** Seconds left today of each game that has its own limit, by appId. */
  gameRemaining?: Record<string, number> }

/** What the wizard offers: two hours on school days from 12 to 21, three on weekends from 9 to 22. */
export const defaultDays = (): KidDayLimit[] => Array.from({ length: 7 }, (_, day) => day === 0 || day === 6 ? { minutes: 180, from: 9, to: 22 } : { minutes: 120, from: 12, to: 21 });
export const NEW_KID: Kid = { name: "", sid: "", enabled: true, dailyMinutes: 120, weekdays: "12-21", weekend: "9-22", games: [], days: defaultDays() };

/** The child's seven days; one set up before there were days gets them from its daily time and its two windows. */
export function kidDays(kid: Kid): KidDayLimit[] {
  if (kid.days?.length === 7) return kid.days;
  const window = (value: string) => { const [from, to] = value.split("-").map(Number); return { from: Number.isFinite(from) ? from : 0, to: Number.isFinite(to) ? to : 24 }; };
  return Array.from({ length: 7 }, (_, day) => ({ minutes: kid.dailyMinutes, ...window(day === 0 || day === 6 ? kid.weekend : kid.weekdays) }));
}

/** The child's week and the adult's live orders in force today. Today it comes from the PC (kid_mode.rs); the same
 *  shape is what the server will give the phone app (vault/Modo niño.md). */
export interface KidDay { date: string; seconds: number; games: Record<string, number> }
export interface KidLive { days: KidDay[]; extraMinutes: number; lockedToday: boolean; channel: boolean }
export type KidControlAction = "extend" | "lock" | "unlock" | "stop";
export const EMPTY_LIVE: KidLive = { days: [], extraMinutes: 0, lockedToday: false, channel: false };

export async function readKidLive(sid: string): Promise<KidLive> {
  if (!hasTauriRuntime() || !sid) return EMPTY_LIVE;
  try { return await invoke<KidLive>("kid_live", { sid }); } catch { return EMPTY_LIVE; }
}

/** Sends a live order; rejects with the code (`needs_apply`: the account was applied before live orders existed). */
export async function sendKidControl(sid: string, action: KidControlAction, minutes = 0): Promise<KidLive> {
  if (!hasTauriRuntime()) return EMPTY_LIVE;
  try { return await invoke<KidLive>("kid_control", { sid, action, minutes }); } catch (error) { throw new KidApplyError(String(error)); }
}
export const validKidName = (name: string) => /^[A-Za-z0-9._-]{1,20}$/.test(name);

const DRAFT_KEY = "gameaccess.kidDraft";
let applied: Kid | null = null;
let draft: Kid = NEW_KID;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* the draft is a convenience */ }
}

/** Reads the family file once (the first child is the one the screen edits) and any unapplied draft. */
export async function loadKidFamily(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (hasTauriRuntime()) {
    try { applied = (await invoke<Family>("kid_family")).kids[0] ?? null; } catch { applied = null; }
  }
  let stored: Kid | null = null;
  try { stored = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null"); } catch { stored = null; }
  draft = stored ?? applied ?? NEW_KID;
  emit();
}

const gameKey = (game: KidGame) => `${game.appId}:${game.dailyMinutes ?? 0}`;
const sameKid = (left: Kid | null, right: Kid) => JSON.stringify(left && { ...left, games: left.games.map(gameKey).sort() })
  === JSON.stringify({ ...right, games: right.games.map(gameKey).sort() });

export interface KidState { draft: Kid; applied: Kid | null; dirty: boolean }
let snapshot: KidState = { draft, applied, dirty: false };
function state(): KidState {
  const dirty = !sameKid(applied, draft) && (applied !== null || draft.name !== "");
  if (snapshot.draft !== draft || snapshot.applied !== applied || snapshot.dirty !== dirty) snapshot = { draft, applied, dirty };
  return snapshot;
}

export function useKidState(): KidState {
  return useSyncExternalStore(subscribe, state, state);
}

export function setKidDraft(change: Partial<Kid>) {
  draft = { ...draft, ...change };
  saveDraft();
  emit();
}

/** Changes one day of the week (0: Sunday). */
export function setKidDay(day: number, change: Partial<KidDayLimit>) {
  setKidDraft({ days: kidDays(draft).map((value, index) => index === day ? { ...value, ...change } : value) });
}

/** Sets (or, with 0, clears) one game's own daily limit. */
export function setKidGameMinutes(appId: number, dailyMinutes: number) {
  setKidDraft({ games: draft.games.map(game => game.appId === appId ? { ...game, dailyMinutes } : game) });
}

/** How many games the child has now (the confirmations say when a removal leaves them with none). */
export const kidGameCount = () => draft.games.length;

/** The child's games among these (a library game is leaving: the confirmation names them). */
export const kidGamesAmong = (appIds: number[]): KidGame[] => draft.games.filter(game => appIds.includes(game.appId));

/** A game left the library: it also leaves the child's list (the change waits for "Apply"). Returns the ones removed. */
export function dropKidGames(appIds: number[]): KidGame[] {
  const gone = kidGamesAmong(appIds);
  if (gone.length) setKidDraft({ games: draft.games.filter(game => !appIds.includes(game.appId)) });
  return gone;
}

export const kidMayPlay = (appId: number | null) => appId != null && draft.games.some(game => game.appId === appId);

/** Shows or hides a library game for the child (the manager's toggle); its folder goes with it. */
export function toggleKidGame(game: LibraryGame) {
  if (game.app_id == null) return;
  const appId = game.app_id;
  const games = kidMayPlay(appId) ? draft.games.filter(item => item.appId !== appId)
    : [...draft.games, { appId, name: game.name, folder: game.folder, executable: "", arguments: [], steam: game.link_kind === "steam" }];
  setKidDraft({ games });
}

/** Shows or hides a shortcut to another program (Roblox, a drawing program) for the child. */
export function toggleKidShortcut(shortcut: AppShortcut) {
  const appId = -shortcut.id;
  const games = kidMayPlay(appId) ? draft.games.filter(item => item.appId !== appId)
    : [...draft.games, { appId, name: shortcut.name, folder: shortcut.folder, executable: shortcut.target, arguments: shortcut.arguments, steam: false }];
  setKidDraft({ games });
}

/** Kid mode is part of PLUS (vault/Proyecto.md): without it the screen explains that and nothing is applied. */
const subscribeTier = (listener: () => void) => { window.addEventListener(ACTIVATION_CHANGED_EVENT, listener); return () => window.removeEventListener(ACTIVATION_CHANGED_EVENT, listener); };
export function usePlus(): boolean {
  return useSyncExternalStore(subscribeTier, () => getActivationTier() === "plus", () => false);
}

/** What the child's account needs to start each game by itself, asked to the launcher now (it may have changed), with
 *  the folder the library showed (the launcher uses it when its games folder does not hold the game). A shortcut
 *  already carries it. A game left without a program is written to the log: the child would see it fail. */
async function withEntries(games: KidGame[]): Promise<KidGame[]> {
  return Promise.all(games.map(async game => {
    if (game.appId < 0) return game;
    let why = "";
    try {
      const result = await invoke<{ ok: boolean; error?: string; entry?: Omit<KidGame, "appId" | "name"> }>("run_digital_process", { action: "kid-entry", appId: game.appId, name: game.name, command: JSON.stringify({ folder: game.folder }), workingDir: null, autoInstalled: false });
      if (result.ok && result.entry) return { ...game, ...result.entry };
      why = result.error ?? "no entry";
    } catch (error) { why = String(error); }
    if (!game.steam && !game.executable) void narrate(`Kid mode: no program found for ${game.name} (AppID ${game.appId}) in ${game.folder}: ${why}`, { area: "KID_MODE", level: "WARN" });
    return game;
  }));
}

export class KidApplyError extends Error { constructor(readonly code: string) { super(code); } }

/** Sends the draft to Windows: creates or updates the child's account and writes the family file. */
export async function applyKidDraft(): Promise<void> {
  if (getActivationTier() !== "plus" && hasTauriRuntime()) throw new KidApplyError("needs_plus");
  if (!validKidName(draft.name)) throw new KidApplyError("bad_name");
  if (!hasTauriRuntime()) { applied = { ...draft }; draft = applied; emit(); return; }
  const kid = { ...draft, games: await withEntries(draft.games) };
  try {
    const family = await invoke<Family>("kid_apply", { kid });
    applied = family.kids.find(item => item.name.toLowerCase() === kid.name.toLowerCase()) ?? null;
  } catch (error) {
    throw reportKidFailure("creating the child's account", error);
  }
  draft = applied ?? kid;
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing kept */ }
  emit();
}

/** A failure of Windows' side of kid mode (kid_mode.rs has the details in its log): written to the app's log and, unless
 *  the person only said no to Windows' permission question, sent to the server as an error so we learn about it. */
function reportKidFailure(what: string, error: unknown): KidApplyError {
  const code = String(error);
  void narrate(`Kid mode: ${what} failed: ${code}`, { area: "KID_MODE", level: code === "cancelled" ? "WARN" : "ERROR" });
  return new KidApplyError(code);
}

/** Undoes kid mode: Windows asks for permission, the child's account and its profile are deleted, the family file and
 *  the time files lose the child, and the screen goes back to how it was before the wizard. */
export async function resetKidMode(): Promise<void> {
  if (hasTauriRuntime() && applied) {
    try { await invoke("kid_remove", { name: applied.name }); } catch (error) { throw reportKidFailure("removing kid mode", error); }
  }
  applied = null;
  draft = { ...NEW_KID, games: [] };
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing kept */ }
  emit();
}

/** The child's session, or null in any other account. */
export async function readKidSession(): Promise<KidSession | null> {
  if (!hasTauriRuntime()) return null;
  try { return await invoke<KidSession | null>("kid_session"); } catch { return null; }
}

/**
 * What an activation check found. PLUS off (ended, revoked or only the base plan): the parent's key goes quiet and the
 * child's account is paused (its Game Access reads `uso\\plus.json`, written here with no Windows permission needed);
 * nothing is deleted. PLUS on again: both resume by themselves. A check that could not reach the server concludes
 * nothing: the caller does not report it.
 */
export function reportPlus(plus: boolean): void {
  setPlusLapsed(!plus);
  if (plus) { rememberPlusConfirmed(Date.now()); setPlusGraceDays(null); }
  else setPlusGraceDays(null);
  if (hasTauriRuntime()) void invoke("kid_plus_set", { active: plus }).catch(() => undefined);
}

/**
 * The server could not be reached, so PLUS is neither confirmed nor refused. Kid mode and the parent's key keep working
 * for a grace period counted from the last time PLUS was confirmed here (a PC that was never confirmed starts counting
 * now): a cut internet must not lock a family out the same day. Once it runs out, it counts as ended (reportPlus(false)).
 * The server saying "no PLUS" is not this case: that one is immediate.
 */
export const PLUS_GRACE_DAYS = 7;
const CONFIRMED_KEY = "gameaccess.plusConfirmedAt";
const DAY_MS = 86_400_000;

function rememberPlusConfirmed(at: number) {
  try { localStorage.setItem(CONFIRMED_KEY, String(at)); } catch { /* the grace then starts at the next check */ }
}

export function reportPlusUnreachable(now = Date.now()): void {
  let confirmed = 0;
  try { confirmed = Number(localStorage.getItem(CONFIRMED_KEY)) || 0; } catch { confirmed = 0; }
  if (!confirmed) { confirmed = now; rememberPlusConfirmed(now); }
  const left = confirmed + PLUS_GRACE_DAYS * DAY_MS - now;
  if (left <= 0) { reportPlus(false); return; }
  setPlusGraceDays(Math.ceil(left / DAY_MS));
}
