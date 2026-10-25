import { useEffect, useState } from "react";

/** The opening (the logo animation) ends with this event; SplashScreen sends it. */
export const LOGO_SETTLED_EVENT = "gameaccess:logo-settled";
/** If the opening never reports (it failed or was skipped), the dialogs are not held back longer than this. */
export const OPENING_MAX_MS = 20_000;

let settled = false;
const listeners = new Set<() => void>();
const settle = () => {
  if (settled) return;
  settled = true;
  for (const listener of listeners) listener();
};
if (typeof window !== "undefined") {
  window.addEventListener(LOGO_SETTLED_EVENT, settle);
  window.setTimeout(settle, OPENING_MAX_MS);
}

const splashPlaying = () => typeof document !== "undefined" && document.body.classList.contains("ga-splash-active");

/**
 * Whether the central dialog may show itself: never over the logo animation. The work behind it (an update
 * download, the catalog) goes on meanwhile; only the dialog waits until the opening has finished.
 */
export function useOpeningSettled(): boolean {
  const [ready, setReady] = useState(() => settled && !splashPlaying());
  useEffect(() => {
    const update = () => setReady(settled && !splashPlaying());
    listeners.add(update);
    // The opening can be replayed (the logo button): the dialog steps aside again while it plays.
    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(update) : null;
    observer?.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    update();
    return () => { listeners.delete(update); observer?.disconnect(); };
  }, []);
  return ready;
}
