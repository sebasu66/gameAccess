/**
 * Parental control state.
 *
 * The policy decides what a locked installation may show. In the app it lives in
 * the native store (`parental_lock.rs`): one file protected by Windows for this
 * account, holding the policy together with its password hash, so clearing the
 * web storage cannot unlock it. The installer chooses whether it starts on (on by
 * default); the password is created at the first launch. Once a password exists,
 * every change needs it.
 *
 * Until the native store answers, the policy is the safe default (on). Outside
 * the app (a plain browser while developing) it falls back to localStorage,
 * without a password.
 */

import { invoke } from "@tauri-apps/api/core";
import type { LibrarySearchFilters } from "./librarySearch";

const STORAGE_KEY = "gameaccess:parental-control:v1";
const listeners = new Set<() => void>();

export type ParentalLevel = "off" | "adult-only" | "strict";

export interface ParentalPolicy {
  /** Whether a policy is enforced at all. */
  enabled: boolean;
  /**
   * adult-only: hide descriptor 3/4 (Valve's adult-only sexual content).
   * strict: also hide descriptor 1 (some nudity or sexual content).
   */
  level: ParentalLevel;
  /** Also hide descriptor 2 (frequent violence or gore). A separate choice. */
  hideViolence: boolean;
}

export interface ParentalState {
  policy: ParentalPolicy;
  /** A password protects every change. */
  hasPassword: boolean;
  /** The parent already answered the first-launch question (created a password or chose "not now"). */
  setUp: boolean;
  /** Seconds to wait before the next password try (after several wrong ones). */
  retryAfterSeconds: number;
  /** The native store has answered. */
  loaded: boolean;
}

/** On unless the installer was told otherwise. */
export const DEFAULT_PARENTAL_POLICY: ParentalPolicy = {
  enabled: true,
  level: "adult-only",
  hideViolence: false,
};

/** Valve descriptor ids blocked by each level. */
export const DESCRIPTOR_IDS_ADULT_ONLY = [3, 4];
export const DESCRIPTOR_IDS_NUDITY = [1];
export const DESCRIPTOR_IDS_VIOLENCE = [2];

/** Why the native store refused a change: wrong_password, password_too_short, retry_later. */
export class ParentalError extends Error {
  constructor(readonly code: "wrong_password" | "password_too_short" | "retry_later" | "failed", readonly retryAfterSeconds = 0, message: string = code) {
    super(message);
  }
}

const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function normalize(policy: Partial<ParentalPolicy>): ParentalPolicy {
  const level: ParentalLevel = policy.level === "strict" ? "strict" : policy.level === "off" ? "off" : "adult-only";
  return { enabled: policy.enabled === true && level !== "off", level, hideViolence: policy.hideViolence === true };
}

let state: ParentalState = initialState();

function initialState(): ParentalState {
  if (native()) return { policy: DEFAULT_PARENTAL_POLICY, hasPassword: false, setUp: true, retryAfterSeconds: 0, loaded: false };
  return { policy: readLocal(), hasPassword: false, setUp: true, retryAfterSeconds: 0, loaded: true };
}

function readLocal(): ParentalPolicy {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw) as Partial<ParentalPolicy>) : DEFAULT_PARENTAL_POLICY;
  } catch {
    return DEFAULT_PARENTAL_POLICY;
  }
}

function writeLocal(policy: ParentalPolicy): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
  } catch {
    // Session-only in that case.
  }
}

function publish(next: ParentalState): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Safe dispatch.
    }
  }
}

interface NativeState { policy: ParentalPolicy; hasPassword: boolean; setUp: boolean; retryAfterSeconds: number }

function fromNative(value: NativeState): ParentalState {
  return { policy: normalize(value.policy), hasPassword: value.hasPassword, setUp: value.setUp, retryAfterSeconds: value.retryAfterSeconds, loaded: true };
}

function toError(error: unknown): ParentalError {
  const text = error instanceof Error ? error.message : String(error);
  if (text === "wrong_password" || text === "password_too_short") return new ParentalError(text);
  if (text.startsWith("retry_later:")) return new ParentalError("retry_later", Number(text.slice(12)) || 0);
  return new ParentalError("failed", 0, text);
}

/** Read the stored policy (once at startup, and after any change made elsewhere). */
export async function loadParentalState(): Promise<ParentalState> {
  if (!native()) return state;
  try {
    publish(fromNative(await invoke<NativeState>("parental_state")));
  } catch {
    // The safe default (on) stays in place.
  }
  return state;
}

/**
 * Save a change. With a password set, `password` must be it; `newPassword`
 * creates or replaces it. Saving without a change records the first-launch
 * answer ("not now").
 */
export async function saveParentalPolicy(change: Partial<ParentalPolicy>, auth: { password?: string; newPassword?: string } = {}): Promise<ParentalState> {
  const policy = normalize({ ...state.policy, ...change });
  if (!native()) {
    writeLocal(policy);
    publish({ ...state, policy });
    return state;
  }
  try {
    publish(fromNative(await invoke<NativeState>("parental_save", { policy, password: auth.password ?? null, newPassword: auth.newPassword ?? null })));
    return state;
  } catch (error) {
    const failure = toError(error);
    if (failure.code === "wrong_password" || failure.code === "retry_later") void loadParentalState();
    throw failure;
  }
}

/** Whether `password` opens the settings, before anything is changed. */
export async function checkParentalPassword(password: string): Promise<void> {
  if (!native()) return;
  try {
    await invoke("parental_check", { password });
  } catch (error) {
    void loadParentalState();
    throw toError(error);
  }
}

export function getParentalState(): ParentalState {
  return state;
}

export function getParentalPolicy(): ParentalPolicy {
  return state.policy;
}

/** True when a policy is enforced, so discovery filters must be disabled. */
export function isParentalLocked(): boolean {
  return state.policy.enabled;
}

export function subscribeParentalPolicy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Set the policy in memory only (tests). */
export function setParentalPolicyForTests(policy: Partial<ParentalPolicy>): ParentalPolicy {
  publish({ ...state, policy: normalize({ ...state.policy, ...policy }) });
  return state.policy;
}

/** Read the stored policy again, as a new start of the app would (tests). */
export function reloadParentalPolicyForTests(): void {
  state = initialState();
}

export function resetParentalPolicyForTests(): void {
  listeners.clear();
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
  state = initialState();
}

/** Descriptor ids hidden by the current policy, or an empty list when unlocked. */
export function blockedDescriptorIds(policy: ParentalPolicy = state.policy): number[] {
  if (!policy.enabled || policy.level === "off") return [];
  const ids = [...DESCRIPTOR_IDS_ADULT_ONLY];
  if (policy.level === "strict") ids.push(...DESCRIPTOR_IDS_NUDITY);
  if (policy.hideViolence) ids.push(...DESCRIPTOR_IDS_VIOLENCE);
  return ids;
}

/** The policy expressed as search filters, so one code path applies it. */
export function parentalSearchFilters(policy: ParentalPolicy = state.policy): Partial<LibrarySearchFilters> {
  if (!policy.enabled || policy.level === "off") return {};
  return {
    hideAdult: true,
    adultIncludesNudity: policy.level === "strict",
    // Violence is its own axis: turning off the adult block must not turn off
    // a violence screen the operator asked for.
    hideViolenceDescriptor: policy.hideViolence,
  };
}

/**
 * Merge the enforced policy over the user's filters. Under a lock the parental
 * keys always win: a discovery tag selection must never reveal blocked content,
 * which is the only thing that makes the control more than cosmetic.
 */
export function applyParentalPolicy(filters: LibrarySearchFilters, policy: ParentalPolicy = state.policy): LibrarySearchFilters {
  const enforced = parentalSearchFilters(policy);
  if (!Object.keys(enforced).length) return filters;
  return { ...filters, ...enforced };
}
