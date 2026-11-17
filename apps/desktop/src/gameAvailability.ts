import type { CatalogGame } from "./types";
import { translate } from "./i18n";

export interface PlayAvailability {
  allowed: boolean;
  reason: string | null;
}

/** Installation readiness determines the Play action; startup only serializes launches. */
export function playAvailability(_game: CatalogGame, busy = false): PlayAvailability {
  if (busy) {
    return {
      allowed: false,
      reason: translate("availabilityBusyReason"),
    };
  }
  return { allowed: true, reason: null };
}
