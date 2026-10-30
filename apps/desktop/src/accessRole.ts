import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import { translate } from "./i18n";

/**
 * Who is using Game Access: the parent (administrator) or a player. Without a parent's key (admin_key.rs) everyone is
 * the administrator, as always. With one, Game Access opens as a player (Seba, 2026-10-30): the frame shows only what a
 * player may use and a parent mode button (ParentModeButton.tsx), which closes the gate asking for the key, once for the
 * whole app. An administrator who leaves the PC alone for a while is a player again.
 */
export type AccessRole = "admin" | "player";
export interface AdminKeyState { enabled: boolean; length: number }

/** After this long without the mouse or keyboard, the administrator becomes a player again (the gate closes). */
export const IDLE_RELOCK_MS = 5 * 60_000;

let role: AccessRole = "admin";
let key: AdminKeyState = { enabled: false, length: 0 };
let asking: Array<(ok: boolean) => void> | null = null;
/** A verification answered that PLUS is not active (ended, revoked or only the base plan): the key is dormant. It is
 *  not set by a failed connection, and not stored: every start verifies again. */
let plusLapsed = false;
/** Days left of the grace given while PLUS could not be checked (the server unreachable); null when there is none running. */
let plusGraceDays: number | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const getAccessRole = (): AccessRole => (plusLapsed ? "admin" : role);
export const isPlusLapsed = () => plusLapsed;
export const getPlusGraceDays = () => plusGraceDays;
export const usePlusGraceDays = (): number | null => useSyncExternalStore(subscribe, getPlusGraceDays, getPlusGraceDays);
export function setPlusGraceDays(days: number | null) {
  if (plusGraceDays === days) return;
  plusGraceDays = days;
  emit();
}
export const usePlusLapsed = (): boolean => useSyncExternalStore(subscribe, isPlusLapsed, isPlusLapsed);
export const getAdminKey = () => key;
export const isAskingForKey = () => asking !== null;
export const useAccessRole = (): AccessRole => useSyncExternalStore(subscribe, getAccessRole, getAccessRole);
export const useAdminKey = (): AdminKeyState => useSyncExternalStore(subscribe, getAdminKey, getAdminKey);
export const useGateRequest = (): boolean => useSyncExternalStore(subscribe, isAskingForKey, isAskingForKey);

/** PLUS ended (or came back). While it is off, the parent's key asks for nothing and everyone is the administrator: Game Access
 *  is as in the base mode. The key's word stays stored, asleep: it works again by itself with PLUS. */
export function setPlusLapsed(next: boolean) {
  if (plusLapsed === next) return;
  plusLapsed = next;
  // A gate that was waiting for the key opens: there is nothing to protect.
  if (next && asking) { const waiting = asking; asking = null; emit(); for (const resolve of waiting) resolve(true); return; }
  emit();
}

export function setAccessRole(next: AccessRole) {
  if (role === next) return;
  role = next;
  emit();
}

/** Reads whether a key is set (and how long today's is). Without Tauri there is none. */
export async function loadAdminKey(): Promise<AdminKeyState> {
  const next = hasTauriRuntime() ? await invoke<AdminKeyState>("admin_key_state") : { enabled: false, length: 0 };
  setAdminKey(next);
  return next;
}

/** The key was set, changed or removed: removing it makes everyone the administrator again. */
export function setAdminKey(next: AdminKeyState) {
  key = next;
  if (!next.enabled) role = "admin";
  emit();
}

/** In the dev browser (no Tauri, so no stored word) the gate can be tried with the design's own example: perro on 11-11-26. */
export const DEV_DEMO_KEY = "perro";

/** Whether what was typed is the parent's key. */
export async function checkAdminKey(attempt: string): Promise<boolean> {
  if (!hasTauriRuntime()) return import.meta.env.DEV && attempt.trim().toLowerCase() === DEV_DEMO_KEY;
  try { return await invoke<boolean>("admin_key_check", { attempt }); } catch { return false; }
}

/**
 * Asks for the administrator before a protected action. True at once when already (or when there is no key);
 * otherwise the gate closes and this waits: true once the key opens it, false when the person enters as a player.
 */
export function requestAdmin(): Promise<boolean> {
  if (getAccessRole() === "admin" || !key.enabled) return Promise.resolve(true);
  return new Promise(resolve => {
    if (asking) asking.push(resolve);
    else { asking = [resolve]; emit(); }
  });
}

/** The gate has opened again: with the key (administrator) or without it (player). */
export function settleGateRequest(admin: boolean) {
  const waiting = asking ?? [];
  asking = null;
  if (admin) role = "admin";
  emit();
  for (const resolve of waiting) resolve(admin);
}

/** How many times the gate went back to the player's frame by itself (AdminGate plays it closing and opening). */
let relocks = 0;
export const useRelocks = (): number => useSyncExternalStore(subscribe, () => relocks, () => relocks);

/** The administrator left the PC alone: back to the player's frame, as when Game Access opens (Seba, 2026-10-30). The
 *  gate closes and opens again without asking: the frame's parent mode button asks for the key. */
export function relock() {
  if (!key.enabled || plusLapsed || role !== "admin") return;
  role = "player";
  relocks += 1;
  emit();
}

export function resetAccessRoleForTests() {
  role = "admin"; key = { enabled: false, length: 0 }; asking = null; plusLapsed = false; plusGraceDays = null; emit();
}

/** Thrown when a protected action was asked for and the person entered as a player instead of giving the key. */
export class AdminRequiredError extends Error { constructor() { super(translate("adminRequired")); this.name = "AdminRequiredError"; } }

/** Before an action only the parent may do: resolves at once for the administrator (or without a key), otherwise closes
 *  the gate asking for the key, and rejects if the person enters as a player. */
export async function requireAdmin(): Promise<void> {
  if (!(await requestAdmin())) throw new AdminRequiredError();
}

/** Dev only: `gaGateDemo()` in the browser console closes the gate asking for the example key (perro), as a player. */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { gaGateDemo: () => Promise<boolean> }).gaGateDemo = () => {
    setAdminKey({ enabled: true, length: DEV_DEMO_KEY.length });
    setAccessRole("player");
    return requestAdmin();
  };
}
