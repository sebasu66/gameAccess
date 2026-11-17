/**
 * The left column as a drawer (Escena, GUI_DESIGN §4.3). The side columns never squeeze: their content would deform.
 * When the window lacks room for the content's minimum (`--ga-nav-content-min`), the activity column steps aside
 * first (CSS alone), and then the left column folds into a drawer that leaves only its tab at the window's edge. The
 * tab also folds and unfolds it by hand: while it fits, unfolded pushes the content (docked); while it does not, it
 * opens over the content and closes again once a section is chosen, with Escape or with a click outside.
 * The state is on the page as `data-ga-nav-drawer` (docked | closed | open) for the screen layer.
 */
import { useCallback, useEffect, useState } from "react";
import { gsap, dur } from "../motion/gsap";
import { queueTransition } from "../motion/transitions";

export type DrawerState = "docked" | "closed" | "open";
const KEY = "gameaccess.nav.drawer.folded.v1";
const MOVING = ".ga-scene-navigation, .ga-scene-dock, .ga-nav-drawer-tab";

const readFolded = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const saveFolded = (folded: boolean) => { try { localStorage.setItem(KEY, folded ? "1" : "0"); } catch { /* only for this session */ } };

/** Whether the left column fits beside the content's minimum (base.css, `--ga-nav-drawer-room`; a negative width is 0). */
export function drawerFits(): boolean {
  if (typeof document === "undefined") return true;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:calc(var(--ga-nav-drawer-room) + 1px)";
  document.documentElement.appendChild(probe);
  const fits = probe.getBoundingClientRect().width >= 1;
  probe.remove();
  return fits;
}

/** Whether the activity column has stepped aside (its width is 0, base.css): it is then out of sight for the keyboard too. */
function markActivity() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:var(--ga-nav-activity-w)";
  document.documentElement.appendChild(probe);
  const hidden = probe.getBoundingClientRect().width < 1;
  probe.remove();
  if (hidden) document.documentElement.dataset.gaNavActivity = "hidden";
  else delete document.documentElement.dataset.gaNavActivity;
}

export const drawerState = (fits: boolean, folded: boolean, open: boolean): DrawerState => fits && !folded ? "docked" : open ? "open" : "closed";

/** Puts the state on the page; the drawer slides from where it was to where the new state puts it (a queued transition). */
function apply(state: DrawerState) {
  const root = document.documentElement;
  if (root.dataset.gaNavDrawer === state) return;
  if (!root.dataset.gaNavDrawer) { root.dataset.gaNavDrawer = state; return; }
  void queueTransition(() => {
    const moving = [...document.querySelectorAll<HTMLElement>(MOVING)];
    const before = moving.map(element => element.getBoundingClientRect().left);
    root.dataset.gaNavDrawer = state;
    const timeline = gsap.timeline();
    moving.forEach((element, index) => {
      const shift = before[index] - element.getBoundingClientRect().left;
      if (shift) timeline.fromTo(element, { x: shift }, { x: 0, duration: dur(.32), ease: "power3.out", clearProps: "transform" }, 0);
    });
    return timeline;
  }, `drawer-${state}`);
}

export function useSideDrawer() {
  const [fits, setFits] = useState(drawerFits);
  const [folded, setFolded] = useState(readFolded);
  const [open, setOpen] = useState(false);
  const state = drawerState(fits, folded, open);

  useEffect(() => {
    const measure = () => { setFits(drawerFits()); markActivity(); };
    window.addEventListener("resize", measure);
    measure();
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => { if (fits) setOpen(false); }, [fits]);
  useEffect(() => { apply(state); }, [state]);
  useEffect(() => () => { delete document.documentElement.dataset.gaNavDrawer; delete document.documentElement.dataset.gaNavActivity; }, []);

  // Open over the content: Escape or a click outside the drawer closes it.
  useEffect(() => {
    if (state !== "open") return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const press = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.(MOVING)) setOpen(false); };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", press, true);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", press, true); };
  }, [state]);

  const toggle = useCallback(() => {
    if (fits) setFolded(current => { saveFolded(!current); return !current; });
    else setOpen(current => !current);
  }, [fits]);
  /** A section was chosen: a drawer open over the content closes. */
  const chosen = useCallback(() => setOpen(false), []);
  return { state, toggle, chosen };
}
