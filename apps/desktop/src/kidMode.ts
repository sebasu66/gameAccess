import { useMemo, useSyncExternalStore } from "react";
import { narrate } from "./narrationLog";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import type { AppShortcut } from "./appShortcuts";
import { ACTIVATION_CHANGED_EVENT, getActivationTier } from "./activation";
import { setPlusGraceDays, setPlusLapsed, useAccessRole } from "./accessRole";

/**
 * Kid mode (vault/Modo niño.md). New model (2026-10-30, src-tauri/src/restrictor.rs): one child, the parent's same
 * Windows account, and a service that while kid mode is on lets only the allow list run: the child's library games, the
 * installed programs the parent leaves ticked, and Windows. The kids screen and the library manager edit a draft here;
 * "Apply" saves it to the restrictor's settings (no Windows permission question). The earlier model, a Windows account
 * for the child (kid_mode.rs and its family file), still runs in a child's account until the parent deletes it.
 */
/** `appId`: a library game's Steam AppID, or `-id` for a shortcut to another program (appShortcuts.ts). */
export interface KidGame { appId: number; name: string; folder: string; executable: string; arguments: string[]; steam: boolean;
  /** Most minutes per day for this game, inside the daily limit; 0 or missing: only the daily limit applies. */
  dailyMinutes?: number;
  /** It asks to run as administrator (the child's account is then made one); set when kid mode is applied. */
  administrator?: boolean }
/** One day of the week: most minutes of play (0: no limit) and the hours the child may use the PC, "from" to "to". */
export interface KidDayLimit { minutes: number; from: number; to: number }
export interface Kid { name: string; sid: string; enabled: boolean; dailyMinutes: number; weekdays: string; weekend: string; games: KidGame[];
  /** Each day of the week, Sunday first (as Windows counts them); when present it rules over the fields above. */
  days?: KidDayLimit[];
  /** The adult's library the child's account plays from (kid_mode.rs sets it when applying). */
  library?: string }
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

/** An installed program the parent allows besides the child's games (everything under its folder runs). */
export interface AllowedProgram { name: string; folder: string }
/** One program of Windows' list: "program" starts allowed; "game" and "launcher" (a game store) start not allowed (games
 *  come from the library) but may be ticked; "windows" is always allowed. */
export interface DetectedProgram extends AllowedProgram { publisher: string; kind: "program" | "game" | "launcher" | "windows" }
/** What the restrictor reads (restrictor.rs `Restriction`). */
export interface Restriction { version: number; enabled: boolean; kid: Kid; programs: AllowedProgram[] }
/** The restrictor itself: its service ("missing" with an installer older than the new model) and whether the settings
 *  can be written here; `enabled`: kid mode is on (the big switch). */
export interface RestrictionStatus { service: "running" | "stopped" | "missing"; writable: boolean; enabled: boolean }
/** One process the restrictor closed. */
export interface RestrictionBlock { at: number; name: string; path: string; game: boolean; count: number }

// "2": the new model starts its wizard from zero; a draft of the child's Windows account is not carried over.
const DRAFT_KEY = "gameaccess.kidDraft2";
const PROGRAMS_KEY = "gameaccess.kidPrograms2";
let applied: Kid | null = null;
let draft: Kid = NEW_KID;
let appliedPrograms: AllowedProgram[] = [];
/** The programs ticked now; null until the parent (or the first detection) chose. */
let programs: AllowedProgram[] | null = null;
let detected: DetectedProgram[] | null = null;
let status: RestrictionStatus = { service: "missing", writable: false, enabled: false };
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); localStorage.setItem(PROGRAMS_KEY, JSON.stringify(programs)); } catch { /* the draft is a convenience */ }
}

/** Reads the restrictor's settings once (the child and the allowed programs) and any unapplied draft. */
export async function loadKidFamily(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (hasTauriRuntime()) {
    try {
      const read = await invoke<{ config: Restriction | null; service: RestrictionStatus["service"]; writable: boolean }>("restriction_state");
      applied = read.config?.kid ?? null;
      appliedPrograms = read.config?.programs ?? [];
      status = { service: read.service, writable: read.writable, enabled: read.config?.enabled ?? false };
    } catch { applied = null; }
  }
  let stored: Kid | null = null;
  let storedPrograms: AllowedProgram[] | null = null;
  try { stored = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null"); storedPrograms = JSON.parse(localStorage.getItem(PROGRAMS_KEY) ?? "null"); } catch { stored = null; }
  draft = stored ?? applied ?? NEW_KID;
  programs = storedPrograms ?? (applied ? appliedPrograms : null);
  emit();
}

/** Windows' list of installed programs, read once. The first time (nothing chosen yet) every program starts allowed. */
export async function loadDetectedPrograms(): Promise<void> {
  if (detected) return;
  detected = hasTauriRuntime() ? await invoke<DetectedProgram[]>("restriction_programs").catch(() => []) : [];
  if (programs === null) programs = detected.filter(item => item.kind === "program").map(({ name, folder }) => ({ name, folder }));
  emit();
}

const sameFolder = (left: string, right: string) => left.replace(/[\\/]+$/, "").toLowerCase() === right.replace(/[\\/]+$/, "").toLowerCase();
export const programAllowed = (folder: string) => (programs ?? []).some(item => sameFolder(item.folder, folder));

/** Ticks or unticks an installed program. */
export function toggleKidProgram(program: AllowedProgram) {
  const list = programs ?? [];
  programs = programAllowed(program.folder) ? list.filter(item => !sameFolder(item.folder, program.folder)) : [...list, { name: program.name, folder: program.folder }];
  saveDraft();
  emit();
}

/** Ticks exactly these programs ("All" and "None"). */
export function setKidPrograms(list: AllowedProgram[]) {
  programs = list;
  saveDraft();
  emit();
}

/** Allows what the restrictor closed: the folder of that program (the change waits for "Apply"). */
export function allowBlocked(block: RestrictionBlock) {
  const folder = block.path.replace(/[\\/][^\\/]*$/, "");
  if (!programAllowed(folder)) toggleKidProgram({ name: block.name, folder });
}

export async function readRestrictionBlocks(): Promise<RestrictionBlock[]> {
  if (!hasTauriRuntime()) return [];
  return invoke<RestrictionBlock[]>("restriction_blocks").catch(() => []);
}

/** The big switch: kid mode's restrictor on or off, saved at once (only for a kid mode already set up). */
export async function setKidModeEnabled(enabled: boolean): Promise<void> {
  if (!applied) return;
  if (hasTauriRuntime()) {
    try { await invoke("restriction_save", { config: { version: 1, enabled, kid: applied, programs: appliedPrograms } }); }
    catch (error) { throw reportKidFailure(enabled ? "turning kid mode on" : "turning kid mode off", error); }
  }
  status = { ...status, enabled };
  emit();
}

const gameKey = (game: KidGame) => `${game.appId}:${game.dailyMinutes ?? 0}`;
const sameKid = (left: Kid | null, right: Kid) => JSON.stringify(left && { ...left, library: undefined, games: left.games.map(gameKey).sort() })
  === JSON.stringify({ ...right, library: undefined, games: right.games.map(gameKey).sort() });
/** One empty list, so the state snapshot stays the same while nothing is chosen (useSyncExternalStore). */
const NO_PROGRAMS: AllowedProgram[] = [];
const programKeys = (list: AllowedProgram[]) => list.map(item => item.folder.toLowerCase()).sort().join("|");

export interface KidState { draft: Kid; applied: Kid | null; dirty: boolean; programs: AllowedProgram[]; detected: DetectedProgram[] | null; status: RestrictionStatus }
let snapshot: KidState = { draft, applied, dirty: false, programs: [], detected, status };
function state(): KidState {
  const chosen = programs ?? NO_PROGRAMS;
  const dirty = (!sameKid(applied, draft) || (applied !== null && programKeys(appliedPrograms) !== programKeys(chosen))) && (applied !== null || draft.name !== "");
  if (snapshot.draft !== draft || snapshot.applied !== applied || snapshot.dirty !== dirty || snapshot.programs !== chosen || snapshot.detected !== detected || snapshot.status !== status) {
    snapshot = { draft, applied, dirty, programs: chosen, detected, status };
  }
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

/** While kid mode is on (the big switch), in parent mode too: the AppIDs of the games assigned to the child. The library
 *  manager marks the others (yellow, with a lock); null while it is off (or not set up). */
export function useKidAssigned(): Set<number> | null {
  const { applied, status } = useKidState();
  return useMemo(() => status.enabled && applied ? new Set(applied.games.map(game => game.appId)) : null, [applied, status.enabled]);
}

/** While kid mode restricts now: on, and not paused by the parent mode (Seba, 2026-10-30: in parent mode the restrictor
 *  pauses and the library shows every game again). The only games the library shows; null otherwise. */
export function useKidRestriction(): Set<number> | null {
  const assigned = useKidAssigned();
  return useAccessRole() === "admin" ? null : assigned;
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

/** What the family file keeps of each game, asked to the launcher now (it may have changed): its folder (the one the
 *  library showed, when the launcher's games folder does not hold it) and whether it asks for administrator. The child
 *  plays it with the library's own play. A shortcut already carries it. A game whose folder is gone is written to the log. */
async function withEntries(games: KidGame[]): Promise<KidGame[]> {
  return Promise.all(games.map(async game => {
    if (game.appId < 0) return game;
    let why = "";
    try {
      const result = await invoke<{ ok: boolean; error?: string; entry?: Omit<KidGame, "appId" | "name"> }>("run_digital_process", { action: "kid-entry", appId: game.appId, name: game.name, command: JSON.stringify({ folder: game.folder }), workingDir: null, autoInstalled: false });
      if (result.ok && result.entry) return { ...game, ...result.entry };
      why = result.error ?? "no entry";
    } catch (error) { why = String(error); }
    void narrate(`Kid mode: no folder for ${game.name} (AppID ${game.appId}) in ${game.folder}: ${why}`, { area: "KID_MODE", level: "WARN" });
    return game;
  }));
}

export class KidApplyError extends Error { constructor(readonly code: string) { super(code); } }

/** Saves the draft to the restrictor's settings: the child, its games (with their folders, asked to the launcher now)
 *  and the allowed programs. Setting it up the first time turns kid mode on. */
export async function applyKidDraft(): Promise<void> {
  if (getActivationTier() !== "plus" && hasTauriRuntime()) throw new KidApplyError("needs_plus");
  if (!validKidName(draft.name)) throw new KidApplyError("bad_name");
  const enabled = applied ? status.enabled : true;
  // Windows' and Microsoft's programs installed outside Windows' folders (PowerToys in AppData) always run: they go to
  // the restrictor with the ticked ones, without being shown as a choice.
  await loadDetectedPrograms();
  const windows = (detected ?? []).filter(item => item.kind === "windows" && !(programs ?? []).some(chosen => sameFolder(chosen.folder, item.folder)));
  const chosen = [...(programs ?? []), ...windows.map(({ name, folder }) => ({ name, folder }))];
  if (!hasTauriRuntime()) { applied = { ...draft }; draft = applied; appliedPrograms = chosen; status = { ...status, enabled }; emit(); return; }
  const kid = { ...draft, games: await withEntries(draft.games) };
  try {
    const saved = await invoke<{ config: Restriction | null; service: RestrictionStatus["service"]; writable: boolean }>("restriction_save", { config: { version: 1, enabled, kid, programs: chosen } });
    applied = saved.config?.kid ?? kid;
    appliedPrograms = saved.config?.programs ?? chosen;
    status = { service: saved.service, writable: saved.writable, enabled: saved.config?.enabled ?? enabled };
  } catch (error) {
    throw reportKidFailure("saving kid mode", error);
  }
  draft = applied;
  programs = appliedPrograms;
  try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(PROGRAMS_KEY); } catch { /* nothing kept */ }
  emit();
}

/** A failure of Windows' side of kid mode (kid_mode.rs has the details in its log): written to the app's log and, unless
 *  the person only said no to Windows' permission question, sent to the server as an error so we learn about it. */
function reportKidFailure(what: string, error: unknown): KidApplyError {
  const code = String(error);
  void narrate(`Kid mode: ${what} failed: ${code}`, { area: "KID_MODE", level: code === "cancelled" ? "WARN" : "ERROR" });
  return new KidApplyError(code);
}

/** Undoes kid mode: the restrictor's settings go (nothing is closed any more) and the screen goes back to the wizard. */
export async function resetKidMode(): Promise<void> {
  if (hasTauriRuntime() && applied) {
    try { await invoke("restriction_clear"); } catch (error) { throw reportKidFailure("removing kid mode", error); }
  }
  applied = null;
  appliedPrograms = [];
  programs = null;
  status = { ...status, enabled: false };
  draft = { ...NEW_KID, games: [] };
  try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(PROGRAMS_KEY); } catch { /* nothing kept */ }
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
