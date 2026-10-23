/**
 * The one place the app gets GSAP from: it registers the plugins the interface uses and answers whether
 * motion is allowed. Components animate inside `useGSAP` (from `@gsap/react`), which cleans up by itself.
 * Rules: animate transform and opacity; with "reduce motion" the final state applies at once.
 */
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { useEffect, useState } from "react";

gsap.registerPlugin(Flip, ScrollTrigger, SplitText, useGSAP);

const REDUCE = "(prefers-reduced-motion: reduce)";

/** False when the system asks to reduce motion (or there is no window, as in some tests). */
export function motionOk(): boolean {
  if (typeof globalThis.matchMedia !== "function") return true;
  return !globalThis.matchMedia(REDUCE).matches;
}

/** True while the system asks to reduce motion; follows changes to the setting. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => !motionOk());
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const query = globalThis.matchMedia(REDUCE);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** Seconds scaled to zero when motion is reduced, so a tween jumps straight to its end. */
export const dur = (seconds: number) => (motionOk() ? seconds : 0);

export { gsap, Flip, ScrollTrigger, SplitText, useGSAP };
