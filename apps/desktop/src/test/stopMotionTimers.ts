/**
 * Vitest setup (vite.config.ts): GSAP's ScrollTrigger keeps a 250 ms timer once it starts listening. In a test file
 * whose last test ends while that timer is pending, it fires after jsdom is gone and fails with "requestAnimationFrame
 * is not defined" (an unhandled error, not a failing test). Each jsdom test file stops it when it ends.
 */
import { afterAll } from "vitest";

afterAll(async () => {
  if (typeof window === "undefined") return;
  const { ScrollTrigger } = await import("gsap/ScrollTrigger");
  try { ScrollTrigger.disable(false, true); } catch { /* never started in this file: there is no timer to stop */ }
});
