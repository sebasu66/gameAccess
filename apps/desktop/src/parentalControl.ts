/**
 * Parental control state.
 *
 * The policy decides what a locked installation may show. It does not yet carry
 * the password: enrolment (argon2 hash inside the per-user DPAPI store) is a
 * separate step, so today a policy can be set without one. `isLocked()` reports
 * whether a policy is enforced, and the UI disables the discovery filters that
 * could otherwise reveal blocked content.
 *
 * Storage here is localStorage, which is deliberately easy to clear: it makes
 * the feature testable while the password store is built. Once enrolment exists,
 * the policy must live with the password hash so clearing one cannot unlock the
 * other.
 */

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

export const DEFAULT_PARENTAL_POLICY: ParentalPolicy = {
  enabled: false,
  level: "adult-only",
  hideViolence: false,
};

/** Valve descriptor ids blocked by each level. */
export const DESCRIPTOR_IDS_ADULT_ONLY = [3, 4];
export const DESCRIPTOR_IDS_NUDITY = [1];
export const DESCRIPTOR_IDS_VIOLENCE = [2];

let cached: ParentalPolicy | null = null;

function read(): ParentalPolicy {
  if (cached) return cached;
  if (typeof localStorage === "undefined") return DEFAULT_PARENTAL_POLICY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PARENTAL_POLICY;
    const parsed = JSON.parse(raw) as Partial<ParentalPolicy>;
    const level: ParentalLevel =
      parsed.level === "strict" ? "strict" : parsed.level === "off" ? "off" : "adult-only";
    cached = { enabled: parsed.enabled === true && level !== "off", level, hideViolence: parsed.hideViolence === true };
    return cached;
  } catch {
    return DEFAULT_PARENTAL_POLICY;
  }
}

function publish(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Safe dispatch.
    }
  }
}

export function getParentalPolicy(): ParentalPolicy {
  return read();
}

export function setParentalPolicy(policy: Partial<ParentalPolicy>): ParentalPolicy {
  const next: ParentalPolicy = { ...read(), ...policy };
  if (next.level === "off") next.enabled = false;
  cached = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Session-only in that case.
  }
  publish();
  return next;
}

/** True when a policy is enforced, so discovery filters must be disabled. */
export function isParentalLocked(): boolean {
  return read().enabled;
}

export function subscribeParentalPolicy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetParentalPolicyForTests(): void {
  cached = null;
  listeners.clear();
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Descriptor ids hidden by the current policy, or an empty list when unlocked. */
export function blockedDescriptorIds(policy: ParentalPolicy = read()): number[] {
  if (!policy.enabled || policy.level === "off") return [];
  const ids = [...DESCRIPTOR_IDS_ADULT_ONLY];
  if (policy.level === "strict") ids.push(...DESCRIPTOR_IDS_NUDITY);
  if (policy.hideViolence) ids.push(...DESCRIPTOR_IDS_VIOLENCE);
  return ids;
}

/** The policy expressed as search filters, so one code path applies it. */
export function parentalSearchFilters(policy: ParentalPolicy = read()): Partial<LibrarySearchFilters> {
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
export function applyParentalPolicy(filters: LibrarySearchFilters, policy: ParentalPolicy = read()): LibrarySearchFilters {
  const enforced = parentalSearchFilters(policy);
  if (!Object.keys(enforced).length) return filters;
  return { ...filters, ...enforced };
}
