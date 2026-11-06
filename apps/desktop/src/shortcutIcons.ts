import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import { narrate } from "./narrationLog";

const DONE_KEY = "gameaccess:shortcut-icons-repaired";
const REPAIR_VERSION = "1";

/** Once, after the update: the game links already on the desktop get their game's icon (game_shortcut.repair_icons). */
export function repairShortcutIcons(): void {
  if (!hasTauriRuntime()) return;
  try {
    if (localStorage.getItem(DONE_KEY) === REPAIR_VERSION) return;
  } catch { return; }
  void invoke<number>("repair_game_shortcuts")
    .then(changed => {
      try { localStorage.setItem(DONE_KEY, REPAIR_VERSION); } catch { /* it is tried again on the next start */ }
      if (changed) void narrate(`Desktop links: ${changed} game icon(s) updated.`, { area: "SHORTCUT" });
    })
    .catch(error => void narrate(`Could not update the desktop links' icons: ${String(error)}`, { area: "SHORTCUT", level: "WARN" }));
}
