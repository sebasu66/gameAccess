/**
 * Which secondary panels are open (docs/TAREA-interfaz-nueva.md T10). In a wide window (≥ WIDE_MIN) the footer
 * buttons are toggles and the panels sit beside the catalog: library manager on the left, downloads on the right and
 * news below downloads. In a smaller window one panel at a time covers the screen, except downloads, which is always
 * a side panel (it needs no more room than that).
 */
import { useEffect, useState, useSyncExternalStore } from "react";

export type DeskPanelId = "manager" | "downloads" | "news";
export const WIDE_MIN = 1800;
const WIDE_QUERY = `(min-width: ${WIDE_MIN}px)`;

let open: DeskPanelId[] = [];
const listeners = new Set<() => void>();
const publish = (next: DeskPanelId[]) => { open = next; listeners.forEach(listener => listener()); };

export const isWideDesk = () => Boolean(globalThis.matchMedia?.(WIDE_QUERY).matches);
/** Panels that open beside the catalog even in a small window. */
const ALWAYS_SIDE: DeskPanelId[] = ["downloads"];
/** Whether a panel sits beside the catalog (true) or covers the screen (false). */
export const isSidePanel = (id: DeskPanelId, wide: boolean) => wide || ALWAYS_SIDE.includes(id);
export const deskOpen = () => open;
export function openPanel(id: DeskPanelId) {
  if (open.includes(id) && (isWideDesk() || open.length === 1)) return;
  publish(isWideDesk() ? [...open, id] : [id]);
}
export function closePanel(id: DeskPanelId) { if (open.includes(id)) publish(open.filter(panel => panel !== id)); }
export function togglePanel(id: DeskPanelId) { if (open.includes(id)) closePanel(id); else openPanel(id); }
export function closeAllPanels() { if (open.length) publish([]); }

export function useDesk(): DeskPanelId[] {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, deskOpen, deskOpen);
}

export function useWideDesk(): boolean {
  const [wide, setWide] = useState(isWideDesk);
  useEffect(() => {
    const media = window.matchMedia?.(WIDE_QUERY);
    if (!media) return;
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return wide;
}

/**
 * Keeps the catalog clear of the open side panels: `--ga-desk-left` / `--ga-desk-right` hold their widths (0 in a
 * small window, where a panel covers the whole screen). Mounted once, in App.
 */
export function useDeskLayout(): void {
  const panels = useDesk();
  const wide = useWideDesk();
  useEffect(() => {
    const root = document.documentElement;
    // In a small window only the last panel opened shows.
    const shown = wide ? panels : panels.slice(-1);
    const left = shown.includes("manager") && isSidePanel("manager", wide);
    const right = shown.some(id => id !== "manager" && isSidePanel(id, wide));
    root.classList.toggle("ga-desk-both", left && right);
    root.classList.toggle("ga-desk-right-open", right);
    root.style.setProperty("--ga-desk-left", left ? "var(--ga-desk-w)" : "0px");
    root.style.setProperty("--ga-desk-right", right ? "var(--ga-desk-w)" : "0px");
    root.style.setProperty("--ga-panel-right", right ? "var(--ga-desk-w)" : "0px");
    root.classList.toggle("ga-desk-paged", shown.some(id => !isSidePanel(id, wide)));
  }, [panels, wide]);
  useEffect(() => () => {
    const root = document.documentElement;
    root.classList.remove("ga-desk-both", "ga-desk-paged", "ga-desk-right-open");
    for (const name of ["--ga-desk-left", "--ga-desk-right", "--ga-panel-right"]) root.style.removeProperty(name);
  }, []);
}
