/**
 * One modal on screen at a time (prototype). Dialogs can open other dialogs (kid mode -> PLUS), and each one draws its
 * own dimmer, so they used to pile up. Here the topmost overlay (highest z-index, the latest in the page on a tie) stays
 * visible and every overlay under it is hidden, not unmounted: its state survives and it is back when the top one closes.
 * No dialog needs to know about this.
 */
const OVERLAYS = ".ga-settings-backdrop, .ga-premium-overlay, .central-dialog-backdrop, .ga-dialog-backdrop, .ga-filter-backdrop, .download-complete-backdrop, .ga-overlay-root";

export function startModalStack(): () => void {
  let frame = 0;
  const apply = () => {
    frame = 0;
    const open = [...document.querySelectorAll<HTMLElement>(OVERLAYS)].filter(el => getComputedStyle(el).position === "fixed");
    let top: HTMLElement | undefined;
    let topZ = -Infinity;
    for (const el of open) {
      const z = Number.parseInt(getComputedStyle(el).zIndex, 10);
      const value = Number.isFinite(z) ? z : 0;
      if (value >= topZ) { top = el; topZ = value; }
    }
    for (const el of open) {
      if (el === top) el.removeAttribute("data-under");
      else el.setAttribute("data-under", "");
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
  return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
}
