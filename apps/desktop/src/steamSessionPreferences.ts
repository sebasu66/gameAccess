export type SteamRestoreMode = "main" | "previous" | "leave";

export interface SteamSessionPreferences {
  restoreMode: SteamRestoreMode;
  mainAccountName: string | null;
}

const STORAGE_KEY = "gameaccess:steam-session-preferences";
const PREVIOUS_ACCOUNT_KEY = "gameaccess:steam-session-previous-account";

export interface SteamPreviousAccount {
  accountName: string;
  userId32: number | null;
}

export function loadSteamSessionPreferences(): SteamSessionPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { restoreMode: "previous", mainAccountName: null };
    const parsed = JSON.parse(raw) as Partial<SteamSessionPreferences>;
    const restoreMode: SteamRestoreMode = ["main", "previous", "leave"].includes(parsed.restoreMode ?? "")
      ? parsed.restoreMode as SteamRestoreMode
      : "previous";
    return {
      restoreMode,
      mainAccountName: typeof parsed.mainAccountName === "string" && parsed.mainAccountName.trim()
        ? parsed.mainAccountName.trim()
        : null,
    };
  } catch {
    return { restoreMode: "previous", mainAccountName: null };
  }
}

export function saveSteamSessionPreferences(preferences: SteamSessionPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent("gameaccess:steam-session-preferences-changed", { detail: preferences }));
}

export function rememberPreviousSteamAccount(account: SteamPreviousAccount): void {
  sessionStorage.setItem(PREVIOUS_ACCOUNT_KEY, JSON.stringify(account));
}

export function consumePreviousSteamAccount(): SteamPreviousAccount | null {
  try {
    const raw = sessionStorage.getItem(PREVIOUS_ACCOUNT_KEY);
    sessionStorage.removeItem(PREVIOUS_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SteamPreviousAccount>;
    if (!parsed.accountName?.trim()) return null;
    return {
      accountName: parsed.accountName.trim(),
      userId32: typeof parsed.userId32 === "number" ? parsed.userId32 : null,
    };
  } catch {
    sessionStorage.removeItem(PREVIOUS_ACCOUNT_KEY);
    return null;
  }
}
