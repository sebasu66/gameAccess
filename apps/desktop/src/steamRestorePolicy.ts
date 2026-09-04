import type { SteamRestoreMode } from "./steamSessionPreferences";

export function safeSteamRestoreMode(
  requestedMode: SteamRestoreMode,
  targetAccountName: string | null | undefined,
  hasAutomaticLogin: boolean,
): SteamRestoreMode {
  if (requestedMode === "leave") return "leave";
  if (!targetAccountName?.trim() || !hasAutomaticLogin) return "leave";
  return requestedMode;
}
