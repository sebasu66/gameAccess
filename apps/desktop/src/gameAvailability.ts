import type { CatalogGame } from "./types";

export interface PlayAvailability {
  licensed: boolean;
  allowed: boolean;
  reason: string | null;
}

/**
 * Storage readiness decides whether the UI offers Play. License availability is
 * resolved by the real lease/session flow when Play is pressed; the catalog's
 * copies_available snapshot can be stale after a download completes.
 */
export function playAvailability(_game: CatalogGame, busy = false): PlayAvailability {
  if (busy) {
    return {
      licensed: true,
      allowed: false,
      reason: "GameAccess está preparando otra sesión.",
    };
  }
  return { licensed: true, allowed: true, reason: null };
}
