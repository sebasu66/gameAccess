/**
 * The app's one queue of transitions (Seba, 2026-10-30): changing mode, the grid and the library manager trading
 * places, a side panel coming or going, the side word changing... each is added here and they run one after the
 * other, never on top of each other. A step builds its own GSAP timeline (with its own timing) and the queue waits for
 * it to end before the next one starts. Continuous motion (hover, magnetic buttons, the ambient background) is not a
 * transition and does not go through the queue.
 */
import { gsap } from "./gsap";

/** What a step returns: its timeline (or tween), any promise to wait for, or nothing when it had nothing to animate. */
type Step = () => gsap.core.Animation | Promise<unknown> | void;

// A step whose animation is killed halfway never ends: past its length (or this, for a plain promise) the queue moves on.
const SAFETY_MS = 400;
const PROMISE_MAX_MS = 4000;

let chain: Promise<void> = Promise.resolve();
let pending = 0;
// Dev only: each step's name, start and end (ms), in `window.__gaTransitionLog`, to see that they never overlap.
const devLog = (label: string) => {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => undefined;
  const log = ((window as unknown as { __gaTransitionLog?: string[] }).__gaTransitionLog ??= []);
  const start = Math.round(performance.now());
  return () => { log.push(`${label} ${start}-${Math.round(performance.now())}`); };
};

/** Adds a transition to the queue; resolves once it has run. `label` names it on the timeline (for debugging). */
export function queueTransition(step: Step, label = "transition"): Promise<void> {
  pending += 1;
  const run = chain.then(() => new Promise<void>(resolve => {
    let finished = false;
    const logged = devLog(label);
    const done = () => { if (finished) return; finished = true; pending -= 1; logged(); resolve(); };
    let result: ReturnType<Step>;
    try { result = step(); } catch { done(); return; }
    if (!result) { done(); return; }
    if (result instanceof gsap.core.Animation) {
      result.data = label;
      setTimeout(done, result.totalDuration() * 1000 + SAFETY_MS);
      result.eventCallback("onComplete", done);
      if (result.totalDuration() === 0 || result.progress() === 1) done();
      return;
    }
    setTimeout(done, PROMISE_MAX_MS);
    void result.then(done, done);
  }));
  chain = run;
  return run;
}

/** True while some transition is running or waiting its turn. */
export const transitionsBusy = () => pending > 0;

/** Waits until the browser has drawn what React just rendered (a new screen) before animating it. */
export const nextFrame = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 16);
});
