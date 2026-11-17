/**
 * The child's screen fits any monitor (Seba, 2026-11-02: on the child's account it looked far too large). Whatever the
 * resolution (1080p, 1440p, 4K, a small laptop) and Windows' scale, which together give the window's size in CSS pixels,
 * the screen is laid out as if it were 1920 x 1080 and zoomed to fill: cards, text and dialogs take the same share of the
 * screen everywhere.
 */
export const KID_DESIGN = { width: 1920, height: 1080 } as const;

/** The zoom for a window of `width` x `height` CSS pixels (innerWidth x innerHeight; physical pixels / devicePixelRatio). */
export function kidScale(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 1;
  const scale = Math.min(width / KID_DESIGN.width, height / KID_DESIGN.height);
  return Math.round(Math.min(3, Math.max(0.5, scale)) * 1000) / 1000;
}

/** Zooms the whole page (the child's account renders only the kid screen, its dialogs and notices) and keeps it right
 *  when the window or the monitor's scale changes. Returns the undo. */
export function applyKidScale(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    const scale = kidScale(window.innerWidth, window.innerHeight);
    root.style.setProperty("zoom", String(scale));
    // For diagnosis: what was measured, in physical pixels.
    root.dataset.kidScale = `${scale} (${Math.round(window.innerWidth * window.devicePixelRatio)}x${Math.round(window.innerHeight * window.devicePixelRatio)} @ ${window.devicePixelRatio})`;
  };
  apply();
  window.addEventListener("resize", apply);
  return () => { window.removeEventListener("resize", apply); root.style.removeProperty("zoom"); delete root.dataset.kidScale; };
}
