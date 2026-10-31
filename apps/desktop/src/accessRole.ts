import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";

/**
 * The parent's key (admin_key.rs) protects only the parental control screen (vault/Modo niño.md, 2026-10-31): Game
 * Access opens without it and everything else is used freely (the child has a Windows account of its own). Opening
 * parental control once kid mode is set up asks for it in a dialog with the gate's field (ParentKeyDialog.tsx).
 */
export interface AdminKeyState { enabled: boolean; length: number }

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
export const useAdminKey = (): AdminKeyState => useSyncExternalStore(subscribe, getAdminKey, getAdminKey);
export const useKeyRequest = (): boolean => useSyncExternalStore(subscribe, isAskingForKey, isAskingForKey);

/** PLUS ended (or came back). While it is off, the parent's key asks for nothing: parental control opens as in the
 *  base mode. The key stays stored, asleep: it works again by itself with PLUS. */
export function setPlusLapsed(next: boolean) {
  if (plusLapsed === next) return;
  plusLapsed = next;
  // A dialog that was waiting for the key lets the parent in: there is nothing to protect.
  if (next && asking) { const waiting = asking; asking = null; emit(); for (const resolve of waiting) resolve(true); return; }
  emit();
}

/** Reads whether a key is set (and how long it is). Without Tauri there is none. */
export async function loadAdminKey(): Promise<AdminKeyState> {
  const next = hasTauriRuntime() ? await invoke<AdminKeyState>("admin_key_state") : { enabled: false, length: 0 };
  setAdminKey(next);
  return next;
}

export function setAdminKey(next: AdminKeyState) {
  key = next;
  emit();
}

/** In the dev browser (no Tauri, so no stored key) the dialog can be tried with this example key. */
export const DEV_DEMO_KEY = "perro";

/** Whether what was typed is the parent's key. */
export async function checkAdminKey(attempt: string): Promise<boolean> {
  if (!hasTauriRuntime()) return import.meta.env.DEV && attempt.trim().toLowerCase() === DEV_DEMO_KEY;
  try { return await invoke<boolean>("admin_key_check", { attempt }); } catch { return false; }
}

/**
 * Before opening parental control: true at once without a key (or with PLUS ended); otherwise the key dialog opens and
 * this waits: true once the key is typed, false when the dialog is closed.
 */
export function requestParentKey(): Promise<boolean> {
  if (!key.enabled || plusLapsed) return Promise.resolve(true);
  return new Promise(resolve => {
    if (asking) asking.push(resolve);
    else { asking = [resolve]; emit(); }
  });
}

/** The key dialog closed: with the key (`true`) or without it. */
export function settleKeyRequest(ok: boolean) {
  const waiting = asking ?? [];
  asking = null;
  emit();
  for (const resolve of waiting) resolve(ok);
}

export function resetAccessRoleForTests() {
  key = { enabled: false, length: 0 }; asking = null; plusLapsed = false; plusGraceDays = null; emit();
}

/** Dev only: `gaKeyDemo()` in the browser console opens the key dialog with the example key (perro). */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { gaKeyDemo: () => Promise<boolean> }).gaKeyDemo = () => {
    setAdminKey({ enabled: true, length: DEV_DEMO_KEY.length });
    return requestParentKey();
  };
}
