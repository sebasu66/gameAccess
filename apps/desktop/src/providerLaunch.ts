import { invoke } from "@tauri-apps/api/core";

import { prepareFrozenGameForPlay } from "./gameStorage";
import { narrate } from "./narrationLog";
import { hasTauriRuntime, type SteamSessionStatus } from "./native";

/**
 * Launch a GameAccess lease after the assigned provider account has already
 * been authenticated by leaseGame(). This path must never resolve or switch to
 * one of the customer's remembered/personal Steam accounts.
 */
export async function openProviderSteamRun(appId: number, providerLabel: string): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  if (!providerLabel.trim()) throw new Error("La reserva no tiene una cuenta proveedora asociada.");
  if (!hasTauriRuntime()) throw new Error("Las sesiones proveedoras de GameAccess requieren la aplicación de escritorio.");

  await prepareFrozenGameForPlay(appId);
  await narrate(
    `Launching GameAccess Steam AppID ${appId} with the provider session that the lease already authenticated. Personal remembered-account resolution is intentionally skipped.`,
    { area: "LAUNCH" },
  );

  await invoke<SteamSessionStatus>("start_steam_game_session", {
    request: {
      appId,
      accountName: providerLabel,
      expectedUserId32: null,
      restoreMode: "leave",
      mainAccountName: null,
      mainUserId32: null,
      previousAccountName: null,
      previousUserId32: null,
    },
  });

  await narrate(
    `Steam accepted the tracked GameAccess provider launch for AppID ${appId}.`,
    { area: "LAUNCH" },
  );
}
