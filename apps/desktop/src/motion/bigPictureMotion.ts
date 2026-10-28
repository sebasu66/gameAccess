/**
 * Entering and leaving big picture mode (bigPicture.ts) as one controlled sequence, each step after the previous one:
 *
 *   enter  1. what the mode hides slides off toward its nearest edge (the header up, the footer down, the side words
 *             to their side), never just vanishing;
 *          2. the opening's two leaves close over the screen (BigPictureIntro.tsx);
 *          3. behind the gate the window goes fullscreen and the grid changes (nothing of that is seen);
 *          4. the gate opens on the mode's card, which then gives way to the grid zooming in to its place.
 *   leave  the legend sinks, the gate closes, the window goes back, the gate opens on the app, and the controls slide
 *          back in from their edges.
 *
 * Transform and opacity only. With "reduce motion" every step applies at once.
 */
import { gsap, motionOk } from "./gsap";

/** What big picture mode hides: keep in step with big-picture.css. */
const HIDDEN = [".ga-search-dock", ".ga-grid-toolbar", ".ga-spotlight", ".library-catalog-tabs", ".ga-library-pills", ".ga-footer-left",
  ".ga-dock > :not(.ga-big-screen-toggle)", ".ga-bento-menu", ".ga-view-rail", ".ga-brand-wall"].join(", ");
const LABEL = ".ga-big-picture-label";
const GATE = ".ga-big-gate";
const CARD = ".ga-big-intro";
const GRID = ".ga-bento-wrap";

const shown = () => [...document.querySelectorAll<HTMLElement>(HIDDEN)].filter(element => element.getClientRects().length > 0);

/** How far an element must move to leave the screen through its nearest edge. */
function offscreen(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  const width = window.innerWidth, height = window.innerHeight;
  const ways = [
    { x: -(box.right + 24), y: 0, distance: box.left },
    { x: width - box.left + 24, y: 0, distance: width - box.right },
    { x: 0, y: -(box.bottom + 24), distance: box.top },
    { x: 0, y: height - box.top + 24, distance: height - box.bottom },
  ];
  // A tall element (a side word) only leaves sideways; anything else by the nearest edge.
  const choices = box.height > height * .6 ? ways.slice(0, 2) : ways;
  const { x, y } = choices.reduce((best, way) => (way.distance < best.distance ? way : best));
  return { x, y };
}

/** The slide uses CSS `translate`, not `transform`: several of these controls (the footer's cubes) keep a transform of
 *  their own in the style sheet, which would win over GSAP's. */
const at = (move: { x: number; y: number }) => `${Math.round(move.x)}px ${Math.round(move.y)}px`;

const done = (timeline: gsap.core.Timeline) => new Promise<void>(resolve => timeline.eventCallback("onComplete", () => resolve()));
const frames = (count: number) => new Promise<void>(resolve => { const step = (left: number) => (left ? window.requestAnimationFrame(() => step(left - 1)) : resolve()); step(count); });

/** Step 1 of entering: the controls the mode hides slide off the screen. */
export function hideForBigPicture(): Promise<void> {
  const elements = shown();
  if (!motionOk() || !elements.length) return Promise.resolve();
  const moves = elements.map(offscreen);
  const timeline = gsap.timeline();
  timeline.to(elements, { translate: index => at(moves[index]), duration: 0.45, ease: "power3.in", stagger: 0.02, overwrite: true });
  return done(timeline);
}

/** The last step of leaving: once the controls are back in the page, they slide in from where they left. */
export function showAfterBigPicture(): Promise<void> {
  return new Promise(resolve => {
    // The page drops the mode's class in an effect, maybe a frame or two later: wait for it (they are hidden until then).
    let tries = 0;
    const run = () => {
      if (document.body.classList.contains("ga-big-screen") && ++tries < 30) { window.requestAnimationFrame(run); return; }
      const elements = shown();
      if (!motionOk() || !elements.length) { gsap.set(elements, { clearProps: "translate" }); resolve(); return; }
      // They come back from off screen: measured where they belong, then sent out and brought in.
      gsap.set(elements, { clearProps: "translate" });
      const moves = elements.map(offscreen);
      gsap.fromTo(elements, { translate: index => at(moves[index]) },
        { translate: "0px 0px", duration: 0.6, ease: "expo.out", stagger: 0.03, overwrite: true, clearProps: "translate", onComplete: resolve });
    };
    window.requestAnimationFrame(run);
  });
}

/** Step 2: the opening's gate closes over the screen (BigPictureIntro.tsx). Entering, the mode's card is set ready
 *  behind it. Resolves once the leaves have met. */
export function closeGate(mode: "enter" | "leave"): Promise<void> {
  const gate = document.querySelector<HTMLElement>(GATE);
  const card = document.querySelector<HTMLElement>(CARD);
  if (!gate) return Promise.resolve();
  const leaves = [gate.querySelector(".gs-leaf.is-left"), gate.querySelector(".gs-leaf.is-right")];
  if (!motionOk()) { gsap.set(gate, { autoAlpha: 1 }); gsap.set(leaves, { xPercent: 0, x: 0 }); return Promise.resolve(); }
  const timeline = gsap.timeline();
  timeline.set(gate, { autoAlpha: 1 })
    .fromTo(leaves, { xPercent: index => (index ? 101 : -101) }, { xPercent: 0, duration: 0.6, ease: "power3.in" })
    // The leaves meet with a small knock.
    .to(leaves, { x: index => (index ? 4 : -4), duration: 0.07, ease: "power1.out", yoyo: true, repeat: 1 });
  // Behind the closed gate: entering, the card waits (shown at once, revealed when the gate opens).
  timeline.call(() => { if (card) gsap.set(card, { autoAlpha: mode === "enter" ? 1 : 0, scale: 1 }); });
  return done(timeline);
}

/** Steps 3 and 4: once the window and the grid changed behind it, the gate opens. Entering, it opens on the mode's
 *  card, which stays to be read (it says how to leave) and then gives way to the grid, zooming in to its place. */
export async function openGate(mode: "enter" | "leave"): Promise<void> {
  const gate = document.querySelector<HTMLElement>(GATE);
  const card = document.querySelector<HTMLElement>(CARD);
  // The window's new size and the grid's new columns settle behind the gate first.
  await frames(2);
  await new Promise(resolve => window.setTimeout(resolve, 250));
  if (!gate) return;
  const leaves = [gate.querySelector(".gs-leaf.is-left"), gate.querySelector(".gs-leaf.is-right")];
  if (!motionOk()) { gsap.set([gate, card], { autoAlpha: 0 }); gsap.set(GRID, { clearProps: "transform" }); return; }
  const timeline = gsap.timeline();
  timeline.to(leaves, { xPercent: index => (index ? 101 : -101), x: 0, duration: 0.9, ease: "expo.inOut" })
    .set(gate, { autoAlpha: 0 });
  if (mode === "enter" && card) {
    timeline.fromTo(card.querySelectorAll(".ga-big-intro-line"), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.08, ease: "power2.out" }, 0.35)
      .to(card, { autoAlpha: 0, duration: 0.4, ease: "power2.in" }, "+=1.2")
      .fromTo(GRID, { scale: 1.08 }, { scale: 1, duration: 0.7, ease: "expo.out", clearProps: "transform" }, "<");
  } else timeline.fromTo(GRID, { scale: 0.96 }, { scale: 1, duration: 0.7, ease: "expo.out", clearProps: "transform" }, 0.2);
  return done(timeline);
}

/** Once in the mode: the legend rises in at the bottom. */
export function labelIn(label: HTMLElement | null): void {
  if (!label || !motionOk()) return;
  gsap.fromTo(label, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.55, ease: "expo.out", delay: 2.9 });
}

/** Before leaving: the legend sinks out. Resolves when it is gone. */
export function labelOut(): Promise<void> {
  const label = document.querySelector<HTMLElement>(LABEL);
  if (!label || !motionOk()) return Promise.resolve();
  return new Promise(resolve => { gsap.to(label, { autoAlpha: 0, y: 24, duration: 0.25, ease: "power2.in", overwrite: true, onComplete: resolve }); });
}
