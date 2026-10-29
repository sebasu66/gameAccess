import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import { translate } from "./i18n";

/**
 * Who is using Game Access: the parent (administrator) or a player. Without a parent's key (admin_key.rs) everyone is
 * the administrator, as always. With one, the app opens at the gate (SplashScreen) asking for it: the key makes the
 * administrator, "enter as player" makes a player, who cannot reach the protected sections (kid mode, parental
 * settings). A player who touches one of them, or an administrator who leaves the PC alone for a while, gets the gate
 * closed again asking for the key with the same field (AdminGate).
 */
export type AccessRole = "admin" | "player";
export interface AdminKeyState { enabled: boolean; length: number }

/** After this long without the mouse or keyboard, the administrator becomes a player again (the gate closes). */
export const IDLE_RELOCK_MS = 5 * 60_000;

let role: AccessRole = "admin";
let key: AdminKeyState = { enabled: false, length: 0 };
let asking: Array<(ok: boolean) => void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const getAccessRole = () => role;
export const getAdminKey = () => key;
export const isAskingForKey = () => asking !== null;
export const useAccessRole = (): AccessRole => useSyncExternalStore(subscribe, getAccessRole, getAccessRole);
export const useAdminKey = (): AdminKeyState => useSyncExternalStore(subscribe, getAdminKey, getAdminKey);
export const useGateRequest = (): boolean => useSyncExternalStore(subscribe, isAskingForKey, isAskingForKey);

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

/** Whether what was typed is today's key. */
export async function checkAdminKey(attempt: string): Promise<boolean> {
  if (!hasTauriRuntime()) return false;
  try { return await invoke<boolean>("admin_key_check", { attempt }); } catch { return false; }
}

/**
 * Asks for the administrator before a protected action. True at once when already (or when there is no key);
 * otherwise the gate closes and this waits: true once the key opens it, false when the person enters as a player.
 */
export function requestAdmin(): Promise<boolean> {
  if (role === "admin" || !key.enabled) return Promise.resolve(true);
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

/** The administrator left the PC alone: back to player, and the gate closes asking for the key. */
export function relock(): Promise<boolean> {
  if (!key.enabled || role !== "admin") return Promise.resolve(role === "admin");
  role = "player";
  emit();
  return requestAdmin();
}

export function resetAccessRoleForTests() {
  role = "admin"; key = { enabled: false, length: 0 }; asking = null; emit();
}

/** Thrown when a protected action was asked for and the person entered as a player instead of giving the key. */
export class AdminRequiredError extends Error { constructor() { super(translate("adminRequired")); this.name = "AdminRequiredError"; } }

/** Before an action only the parent may do: resolves at once for the administrator (or without a key), otherwise closes
 *  the gate asking for the key, and rejects if the person enters as a player. */
export async function requireAdmin(): Promise<void> {
  if (!(await requestAdmin())) throw new AdminRequiredError();
}
