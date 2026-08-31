import type { SteamRestoreMode } from "./steamSessionPreferences";

export function safeSteamRestoreMode(
  requestedMode: SteamRestoreMode,
  targetAccountName: string | null | undefined,
  hasEnrolledCredential: boolean,
): SteamRestoreMode {
  if (requestedMode === "leave") return "leave";
  if (!targetAccountName?.trim() || !hasEnrolledCredential) return "leave";
  return requestedMode;
}
