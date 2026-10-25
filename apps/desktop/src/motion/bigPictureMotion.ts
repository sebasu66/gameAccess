/**
 * Entering and leaving big picture mode (bigPicture.ts) as an animated change: what the mode hides (big-picture.css)
 * slides away toward its own edge and fades before it is taken out, and comes back the same way when the mode ends;
 * the mode's label rises in and sinks out at the bottom centre. The library's cards that leave (not ready) animate
 * by themselves (LibraryBento's Flip). With "reduce motion" everything changes at once.
 */
import { gsap, motionOk } from "./gsap";

/** What big picture mode hides: keep in step with big-picture.css. */
const HIDDEN = [".ga-search-dock", ".ga-grid-toolbar", ".ga-spotlight", ".library-catalog-tabs", ".ga-library-pills", ".ga-footer-left", ".ga-dock > :not(.ga-big-screen-toggle)", ".ga-bento-menu"].join(", ");
const LABEL = ".ga-big-picture-label";
const OUT = 0.35, IN = 0.55;

const shown = () => [...document.querySelectorAll<HTMLElement>(HIDDEN)].filter(element => element.getClientRects().length > 0);
/** Toward the nearer edge: up for what sits in the top half, down for the footer and the bottom controls. */
const drift = (element: Element) => (element.getBoundingClientRect().top > window.innerHeight / 2 ? 28 : -28);

/** Before the mode starts: the controls it hides slide away. Resolves when they are gone. */
export function hideForBigPicture(): Promise<void> {
  const elements = shown();
  if (!motionOk() || !elements.length) return Promise.resolve();
  return new Promise(resolve => {
    gsap.to(elements, { opacity: 0, y: (index: number) => drift(elements[index]), duration: OUT, ease: "power2.in", stagger: 0.025, overwrite: true, onComplete: resolve });
  });
}

/** Once the mode has ended and they are back in the page: the same controls come in from where they left. */
export function showAfterBigPicture(): void {
  // The page drops the mode's class in an effect, maybe a frame or two later: wait for it (they are hidden until then).
  let frames = 0;
  const run = () => {
    if (document.body.classList.contains("ga-big-screen") && ++frames < 30) { window.requestAnimationFrame(run); return; }
    const elements = shown();
    if (!motionOk()) { gsap.set(elements, { clearProps: "opacity,transform" }); return; }
    gsap.fromTo(elements, { opacity: 0, y: (index: number) => drift(elements[index]) },
      { opacity: 1, y: 0, duration: IN, ease: "expo.out", stagger: 0.03, overwrite: true, clearProps: "opacity,transform" });
  };
  window.requestAnimationFrame(run);
}

/** The label rises in when the mode starts. */
export function labelIn(label: HTMLElement | null): void {
  if (!label || !motionOk()) return;
  gsap.fromTo(label, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: IN, ease: "expo.out", delay: 0.15 });
}

/** Before the mode ends: the label sinks out. Resolves when it is gone. */
export function labelOut(): Promise<void> {
  const label = document.querySelector<HTMLElement>(LABEL);
  if (!label || !motionOk()) return Promise.resolve();
  return new Promise(resolve => { gsap.to(label, { opacity: 0, y: 24, duration: 0.25, ease: "power2.in", overwrite: true, onComplete: resolve }); });
}
