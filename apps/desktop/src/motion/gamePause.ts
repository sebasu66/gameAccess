/**
 * While a game is running, Game Access does not animate (Seba, 2026-11-16): it must not take the PC's resources from
 * the game. `setGamePlaying(true)` is called when a game is started (gameFocus.ts, `watchGameFocus`) and false when it
 * ends (`gameaccess:game-ended`, the same event that brings the app back to the front). Playing:
 *  - GSAP's clock sleeps (no tween, timeline or Flip advances; the transition queue's own timeout lets it go on),
 *  - the page carries `ga-game-running`, which pauses every CSS animation and transition (motion/game-pause.css),
 *  - videos stop. The app also sleeps while its window is hidden or minimised, whatever the cause.
 * Everything resumes where it was when the game ends or the window is shown again.
 */
import { gsap } from "./gsap";

let playing = false;
let hidden = typeof document !== "undefined" && document.visibilityState === "hidden";

function apply(): void {
  if (typeof document === "undefined") return;
  const asleep = playing || hidden;
  document.documentElement.classList.toggle("ga-game-running", asleep);
  if (asleep) {
    gsap.ticker.sleep();
    document.querySelectorAll("video").forEach(video => { try { video.pause(); } catch { /* not a playing video */ } });
  } else gsap.ticker.wake();
}

export function setGamePlaying(value: boolean): void {
  if (playing === value) return;
  playing = value;
  apply();
}

export const gamePlaying = () => playing;

/** Called once at start: also sleeps while the window is hidden or minimised. */
export function watchWindowVisibility(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const change = () => { hidden = document.visibilityState === "hidden"; apply(); };
  document.addEventListener("visibilitychange", change);
  change();
  return () => document.removeEventListener("visibilitychange", change);
}
