import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";

/**
 * The controller's Xbox button for Game Access instead of Steam (steam_guide.rs). The player's choice is kept here;
 * on start the app listens to the button again and, if Steam still had it (it was open when the choice was made),
 * takes it away now that Steam may be closed.
 */
const KEY = "gameaccess:guide-button";
export interface GuideState { found: boolean; steam_running?: boolean; bound?: number; released?: boolean }

export const guideChosen = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const remember = (on: boolean) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* this session only */ } };

export const guideState = () => invoke<GuideState>("steam_guide_state");

/** Turns it on or off. Resolves to what is still pending: "steam_running" when Steam must be closed first. */
export async function setGuideForGameAccess(on: boolean): Promise<"done" | "steam_running" | "not_found"> {
  remember(on);
  await invoke("steam_guide_listen", { on });
  try {
    if (on) await invoke<number>("steam_guide_release");
    else if ((await guideState()).released) await invoke("steam_guide_restore");
    return "done";
  } catch (error) {
    const said = String(error);
    return said === "steam_running" ? "steam_running" : said === "not_found" ? "not_found" : (() => { throw error; })();
  }
}

/** At start: listen again and finish what Steam was holding back. */
export function startSteamGuide(): void {
  if (!hasTauriRuntime() || !guideChosen()) return;
  void invoke("steam_guide_listen", { on: true }).catch(() => undefined);
  void guideState().then(state => { if (state.found && state.bound && !state.steam_running) return invoke("steam_guide_release"); }).catch(() => undefined);
}

export const GUIDE_BUTTON_EVENT = "gameaccess:guide-button";
