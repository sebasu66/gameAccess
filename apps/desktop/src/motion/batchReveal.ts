/**
 * Cards that reveal themselves in batches as they scroll into view. This follows GSAP's official
 * `ScrollTrigger.batch()` Advanced Demo (https://gsap.com/docs/v3/Plugins/ScrollTrigger/static.batch(),
 * https://codepen.io/GreenSock/pen/zYrxpmb) and keeps its values: start at `y: 100` and hidden; on enter
 * `to({opacity: 1, y: 0, stagger: 0.15, overwrite: true})` with `ease: "power3"`; on leave (down) set to
 * `y: -100` hidden, on leave back (up) set to `y: 100` hidden; and a `refreshInit` listener that puts `y`
 * back to 0 while ScrollTrigger measures, because the offset would throw off the positions.
 *
 * Adapted to the sliding window (only the cards near the screen are mounted): the cards that mount are added
 * to a batch and the ones that unmount lose their ScrollTrigger, instead of batching one fixed list. The
 * scroller is the grid's scroll container, not the window. With "reduce motion" nothing is hidden or moved.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { gsap, motionOk, ScrollTrigger } from "./gsap";

const EASE = "power3";

/** The cards inside the scroller's view that are still hidden: shown now. A card ScrollTrigger measured before the
 *  grid moved (a filter, the sliding window) never gets its onEnter while it sits in view, and would stay empty. */
function revealInView(scroller: HTMLElement, cards: Iterable<Element>): void {
  const view = scroller.getBoundingClientRect();
  const hidden = [...cards].filter(card => {
    if (Number(gsap.getProperty(card, "opacity")) >= 1) return false;
    // Where it sits without its hidden offset.
    const box = card.getBoundingClientRect(), offset = Number(gsap.getProperty(card, "y")) || 0;
    return box.bottom - offset > view.top && box.top - offset < view.bottom;
  });
  if (hidden.length) gsap.to(hidden, { opacity: 1, y: 0, ease: EASE, stagger: 0.15, overwrite: true });
}

export function useBatchReveal(container: RefObject<HTMLElement>, selector: string, mounted: unknown, layout: unknown): void {
  const triggers = useRef(new Map<Element, ScrollTrigger>());

  // Every change of the mounted set: register the new cards, drop the ones that are gone.
  useLayoutEffect(() => {
    const host = container.current;
    const scroller = host?.closest<HTMLElement>(".library-section-scroll");
    if (!host || !scroller || !motionOk()) return;
    const known = triggers.current;
    for (const [element, trigger] of known) {
      if (!element.isConnected) { trigger.kill(); known.delete(element); }
    }
    const fresh = [...host.querySelectorAll<HTMLElement>(selector)].filter(element => !known.has(element));
    if (!fresh.length) { ScrollTrigger.refresh(); revealInView(scroller, known.keys()); return; }
    // Set before the first paint, so a new card never flashes in its final place.
    gsap.set(fresh, { opacity: 0, y: 100 });
    const created = ScrollTrigger.batch(fresh, {
      scroller,
      onEnter: batch => gsap.to(batch, { opacity: 1, y: 0, ease: EASE, stagger: 0.15, overwrite: true }),
      onLeave: batch => gsap.set(batch, { opacity: 0, y: -100, overwrite: true }),
      onEnterBack: batch => gsap.to(batch, { opacity: 1, y: 0, ease: EASE, stagger: 0.15, overwrite: true }),
      onLeaveBack: batch => gsap.set(batch, { opacity: 0, y: 100, overwrite: true }),
    });
    created.forEach((trigger, index) => known.set(fresh[index], trigger));
    // The cards that stayed may have moved with the new ones: measure again, and show what is in view.
    ScrollTrigger.refresh();
    revealInView(scroller, known.keys());
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // The grid moved (a group opened, a card changed group, another width): measure again.
  useLayoutEffect(() => {
    const scroller = container.current?.closest<HTMLElement>(".library-section-scroll");
    if (!triggers.current.size || !scroller) return;
    ScrollTrigger.refresh();
    revealInView(scroller, triggers.current.keys());
  }, [layout]);

  useLayoutEffect(() => {
    // From the demo: while ScrollTrigger measures, the cards go back to y: 0; returning the set reverts it after.
    // (GSAP's types say the listener returns void; the demo returns the set on purpose, so it is cast.)
    const reset = (() => gsap.set([...triggers.current.keys()], { y: 0 })) as unknown as () => void;
    ScrollTrigger.addEventListener("refreshInit", reset);
    const known = triggers.current;
    return () => {
      ScrollTrigger.removeEventListener("refreshInit", reset);
      for (const trigger of known.values()) trigger.kill();
      known.clear();
    };
  }, []);
}
