/**
 * How the app opens (Settings › Appearance): the screen it starts on and whether the opening plays its sound.
 * A new install opens on Home, where the welcome is (Seba, 2026-11-03).
 */
export type StartScreen = "home" | "catalog" | "library";
export interface StartupPreferences { startScreen: StartScreen; muteOpening: boolean }

export const STARTUP_KEY = "gameaccess:startup:v1";
export const DEFAULT_STARTUP: StartupPreferences = { startScreen: "home", muteOpening: false };
const SCREENS: StartScreen[] = ["home", "catalog", "library"];

export function normalizeStartup(value: unknown): StartupPreferences {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    startScreen: SCREENS.includes(raw.startScreen as StartScreen) ? raw.startScreen as StartScreen : DEFAULT_STARTUP.startScreen,
    muteOpening: typeof raw.muteOpening === "boolean" ? raw.muteOpening : DEFAULT_STARTUP.muteOpening,
  };
}

export function loadStartup(): StartupPreferences {
  try { return normalizeStartup(JSON.parse(localStorage.getItem(STARTUP_KEY) || "null")); }
  catch { return { ...DEFAULT_STARTUP }; }
}

export function saveStartup(value: StartupPreferences): void {
  try { localStorage.setItem(STARTUP_KEY, JSON.stringify(normalizeStartup(value))); } catch { /* the choice applies from the next opening */ }
}

/** The screen chosen for this opening, read once: changing the setting applies from the next opening. */
const openedOn = loadStartup().startScreen;
const taken = new Set<StartScreen>();
/** Whether this opening starts on that screen and it has not been used yet (asking does not use it: React may ask twice). */
export function opensOn(screen: StartScreen): boolean {
  return openedOn === screen && !taken.has(screen);
}

/** The opening screen was shown: a later remount (another catalog mode) does not go back to it. */
export function startScreenUsed(screen: StartScreen): void {
  taken.add(screen);
}
