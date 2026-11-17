/**
 * The activity column folds and unfolds by hand (Seba, 2026-11-16), with a handle on its left edge, like the left
 * column's drawer tab (sideDrawer.ts). Folded, it slides out to the right, the content takes its room and only the
 * handle stays at the window's edge. The choice is remembered on this computer. When the window has no room for the
 * column anyway (it steps aside by itself, base.css), there is no handle.
 * The state is on the page as `data-ga-nav-activity-fold="closed"` for the screen layer.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "gameaccess.nav.activity.folded.v1";
const readFolded = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const saveFolded = (folded: boolean) => { try { localStorage.setItem(KEY, folded ? "1" : "0"); } catch { /* only for this session */ } };

/** Whether the column has room to show (its width, unfolded, is not 0). */
function activityFits(): boolean {
  if (typeof document === "undefined") return true;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:var(--ga-nav-activity-w)";
  document.documentElement.appendChild(probe);
  const fits = probe.getBoundingClientRect().width >= 1;
  probe.remove();
  return fits;
}

export function useActivityFold() {
  const [folded, setFolded] = useState(readFolded);
  const [fits, setFits] = useState(activityFits);
  useEffect(() => {
    const measure = () => setFits(activityFits());
    window.addEventListener("resize", measure);
    measure();
    return () => window.removeEventListener("resize", measure);
  }, []);
  const closed = folded && fits;
  useEffect(() => {
    const root = document.documentElement;
    if (closed) root.dataset.gaNavActivityFold = "closed"; else delete root.dataset.gaNavActivityFold;
    // The left drawer measures the room again: folding this column may give it enough to dock.
    window.dispatchEvent(new Event("resize"));
  }, [closed]);
  useEffect(() => () => { delete document.documentElement.dataset.gaNavActivityFold; }, []);
  const toggle = useCallback(() => setFolded(current => { saveFolded(!current); return !current; }), []);
  return { fits, folded: closed, toggle };
}
