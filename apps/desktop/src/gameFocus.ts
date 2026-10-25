import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriRuntime } from "./native";

/**
 * Focus around play (src-tauri/src/game_focus.rs): the started game gets the focus; when it ends Game Access comes
 * back to the front and the game grid has the focus, so the controller (big picture mode) or the keyboard can pick the
 * next game at once. Whenever the window is activated with nothing focused, the grid takes the focus too.
 */
export const GAME_ENDED_EVENT = "gameaccess:game-ended";

/** Follows the game started from `folder` (its install folder, Steam games included). */
export function watchGameFocus(folder?: string | null): void {
  if (!folder || !hasTauriRuntime()) return;
  void invoke("game_focus_watch", { folder }).catch(() => undefined);
}

const CARD = ".ga-bento-card, .library-room-card";

/** Focus on the selected card of the grid (library or catalog), or its first card. */
export function focusGrid(): boolean {
  const target = document.querySelector<HTMLElement>(`.ga-bento-card[aria-current="true"], .library-room-card.is-selected`)
    ?? Array.from(document.querySelectorAll<HTMLElement>(CARD)).find(card => card.getClientRects().length > 0);
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest" });
  return document.activeElement === target;
}

/** Nothing the player is using has the focus: no field, no dialog, no menu, no open panel. */
function focusIsFree(): boolean {
  const active = document.activeElement;
  if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"]')) return false;
  return !active || active === document.body || active === document.documentElement;
}

export function useGridFocus(): void {
  useEffect(() => {
    let frame = 0;
    const soon = (force: boolean) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => { if (force || focusIsFree()) focusGrid(); });
    };
    // The window was activated (Alt+Tab, a click on the taskbar, the end of a game).
    const activated = () => soon(false);
    window.addEventListener("focus", activated);
    // At start: once the grid is there (after the opening), unless the player already focused something.
    let tries = 0;
    const start = window.setInterval(() => {
      if (++tries > 60 || !focusIsFree()) { window.clearInterval(start); return; }
      if (focusGrid()) window.clearInterval(start);
    }, 500);
    let unlisten: (() => void) | undefined;
    let stopped = false;
    if (hasTauriRuntime()) {
      void listen(GAME_ENDED_EVENT, () => soon(!document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')))
        .then(dispose => { if (stopped) dispose(); else unlisten = dispose; });
    }
    return () => { stopped = true; window.removeEventListener("focus", activated); window.clearInterval(start); window.cancelAnimationFrame(frame); unlisten?.(); };
  }, []);
}
