import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import type { KidSession } from "./kidMode";

/**
 * The controller's Xbox button for Game Access instead of Steam (steam_guide.rs). The player's choice is kept here and
 * starts as the installer left it (on by default). On start the app listens to the button again and takes it away from
 * Steam: at once with Steam closed; with Steam open, restarting it, at most once a day and never during a game.
 */
const KEY = "gameaccess:guide-button";
const RESTARTED_KEY = "gameaccess:guide-restart";
const DAY_MS = 86400000;
export interface GuideState { found: boolean; steam_running?: boolean; bound?: number; focus_pending?: number; released?: boolean }

/** On unless the player turned it off: Steam's Big Picture covers ours. */
export const guideChosen = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
const remember = (on: boolean) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* this session only */ } };

export const guideState = () => invoke<GuideState>("steam_guide_state");

/** Turns it on or off. Resolves to what is still pending: "steam_running" when Steam must be closed first. */
export async function setGuideForGameAccess(on: boolean): Promise<"done" | "steam_running" | "not_found"> {
  remember(on);
  await invoke("steam_guide_listen", { on, closed: on });
  try {
    if (on) await invoke<number>("steam_guide_release");
    else if ((await guideState()).released) await invoke("steam_guide_restore");
    return "done";
  } catch (error) {
    const said = String(error);
    return said === "steam_running" ? "steam_running" : said === "not_found" ? "not_found" : (() => { throw error; })();
  }
}

/** Steam open: closes it, turns its button off in every account and starts it again. */
export const restartSteamForGuide = () => invoke<void>("steam_guide_restart");

/** The kid wizard: on when it finishes, restarting Steam if it is open. A failure leaves the start of the app to retry. */
export async function takeGuideForKid(): Promise<void> {
  if (await setGuideForGameAccess(true) === "steam_running") await restartSteamForGuide();
}

/** The restart without being asked happens once a day at most: a PC where it cannot be applied would repeat it. */
function restartAllowed(now = Date.now()): boolean {
  try {
    if (now - Number(localStorage.getItem(RESTARTED_KEY) ?? 0) < DAY_MS) return false;
    localStorage.setItem(RESTARTED_KEY, String(now));
    return true;
  } catch { return false; }
}

/** At start: the child's account follows what the adult chose; any other starts from the installer's choice. */
export async function startSteamGuide(): Promise<void> {
  if (!hasTauriRuntime()) return;
  const session = await invoke<KidSession | null>("kid_session").catch(() => null);
  if (session) {
    await invoke("steam_guide_listen", { on: !session.kid.keepSteamGuide, closed: false }).catch(() => undefined);
    return;
  }
  try { if (localStorage.getItem(KEY) === null) remember(await invoke<boolean>("steam_guide_default")); } catch { /* stays on */ }
  if (!guideChosen()) return;
  await invoke("steam_guide_listen", { on: true, closed: true }).catch(() => undefined);
  const state = await guideState().catch(() => null);
  if (!state?.found) return;
  if (!state.steam_running) { if (state.bound || state.focus_pending) await invoke("steam_guide_release").catch(() => undefined); return; }
  if (state.focus_pending && restartAllowed()) await restartSteamForGuide().catch(() => undefined);
}

export const GUIDE_BUTTON_EVENT = "gameaccess:guide-button";
