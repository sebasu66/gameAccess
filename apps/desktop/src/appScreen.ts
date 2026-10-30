/**
 * Which screen (mode) fills the app (docs/GUI_DESIGN.md §0b): the games (catalog and library) or one of the screens
 * chosen from the frame. A screen is not a dialog: it has no close button, and one leaves it by choosing another mode.
 * While a screen is on, the games behind it are hidden (html.ga-screen-on) and the game detail closes (LibraryRoom).
 * Changing mode is one step of the transition queue (motion/transitions.ts), animated like the grid and the library
 * manager trading places: what is shown leaves upward and fades, then the new mode comes in from below.
 * Stage: prototype (docs/TAREA-pantallas-y-modos.md, P4); settings and home join later.
 */
import { useSyncExternalStore } from "react";
import { dur, gsap } from "./motion/gsap";
import { nextFrame, queueTransition } from "./motion/transitions";

export type AppScreen = "games" | "kids";

let screen: AppScreen = "games";
// The last mode asked for (queued changes run in order; asking again for it adds nothing).
let target: AppScreen = "games";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Sent as soon as another mode is chosen (before the animation): the game detail closes on it. */
export const SCREEN_CHANGE_EVENT = "gameaccess:screen-change";

export const getAppScreen = () => screen;
export const useAppScreen = (): AppScreen => useSyncExternalStore(subscribe, getAppScreen, getAppScreen);

/** What a mode shows on the page: the games are the catalog's area, its top bar and the side word; a screen is itself. */
function shown(mode: AppScreen): Element[] {
  if (typeof document === "undefined") return [];
  const parts = mode === "games" ? [".app-shell > main", "header.topbar > :not(.topbar-actions)", ".ga-view-rail"] : [".ga-screen"];
  return parts.flatMap(selector => Array.from(document.querySelectorAll(selector)));
}

function apply(next: AppScreen) {
  screen = next;
  if (typeof document !== "undefined") document.documentElement.classList.toggle("ga-screen-on", next !== "games");
  for (const listener of listeners) listener();
}

export function setAppScreen(next: AppScreen) {
  if (next === target) return;
  target = next;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SCREEN_CHANGE_EVENT));
  void queueTransition(() => change(next), `screen:${next}`);
}

/** One change of mode: the shown one leaves (0.2 s), the new one is put in place hidden, then comes in (0.5 s). */
async function change(next: AppScreen): Promise<void> {
  if (screen === next) return;
  const out = shown(screen);
  if (out.length) await gsap.timeline().to(out, { opacity: 0, y: -16, duration: dur(.2), ease: "power2.in" });
  // A screen is born hidden (GaScreen); the games are hidden here before they show again.
  if (next === "games") gsap.set(shown("games"), { opacity: 0 });
  apply(next);
  gsap.set(out, { clearProps: "opacity,transform" });
  let into = shown(next);
  // The new screen is React's to render: wait a few frames for it.
  for (let frame = 0; frame < 10 && !into.length; frame += 1) { await nextFrame(); into = shown(next); }
  if (!into.length) return;
  await gsap.timeline().fromTo(into, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: dur(.5), ease: "expo.out", clearProps: "opacity,transform" });
}
