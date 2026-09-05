import type { CatalogGame } from "./types";

export interface PlayAvailability {
  licensed: boolean;
  allowed: boolean;
  reason: string | null;
}

export function playAvailability(game: CatalogGame, busy = false): PlayAvailability {
  const licensed = game.copies_available > 0 || Boolean(game.local_primary_account_label);
  if (busy) return { licensed, allowed: false, reason: "GameAccess está preparando otra sesión." };
  if (!licensed) return { licensed: false, allowed: false, reason: "El juego está instalado, pero no hay una licencia disponible en este momento." };
  return { licensed: true, allowed: true, reason: null };
}
