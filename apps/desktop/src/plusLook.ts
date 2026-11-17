import { ACTIVATION_CHANGED_EVENT, getActivationTier } from "./activation";
import "./plus-look.css";

/**
 * The PLUS look (Seba, 2026-11-04): with PLUS on, the device wears gold — the frame's lines and the name on its tab,
 * and on the opening's cover a gold frame, gold engraved lines and a PLUS mark in a corner (plus-look.css). The class
 * `ga-plus` on <html> carries it. The last known tier is remembered, so the cover is already gold at the next start,
 * before access is checked again; only the look reads it, never what PLUS unlocks.
 */
const LOOK = "gameaccess:look-plus";

function setPlusLook(on: boolean): void {
  document.documentElement.classList.toggle("ga-plus", on);
  try { if (on) localStorage.setItem(LOOK, "1"); else localStorage.removeItem(LOOK); } catch { /* only the look */ }
}

export function startPlusLook(): void {
  try { document.documentElement.classList.toggle("ga-plus", localStorage.getItem(LOOK) === "1"); } catch { /* only the look */ }
  window.addEventListener(ACTIVATION_CHANGED_EVENT, () => setPlusLook(getActivationTier() === "plus"));
}
