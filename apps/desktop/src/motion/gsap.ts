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

// ScrollTrigger reads matchMedia when it registers. The app's webview always has it; jsdom (tests) does not.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}
gsap.registerPlugin(Flip, ScrollTrigger, SplitText, useGSAP);

/** Game Access animations are independent of the Windows motion setting. */
export function motionOk(): boolean { return true; }
export function useReducedMotion(): boolean { return false; }
export const dur = (seconds: number) => seconds;

export { gsap, Flip, ScrollTrigger, SplitText, useGSAP };
