import type { CatalogGame } from "./types";

export interface PlayAvailability {
  allowed: boolean;
  reason: string | null;
}

/** Installation readiness determines the Play action; startup only serializes launches. */
export function playAvailability(_game: CatalogGame, busy = false): PlayAvailability {
  if (busy) {
    return {
      allowed: false,
      reason: "GameAccess está preparando otro juego.",
    };
  }
  return { allowed: true, reason: null };
}
