/**
 * The mode rail in the app: <ga-mode-rail> in the first column, showing the mode chosen from the frame (Home, Catalog,
 * Library, Parental, Settings) with the look chosen in Settings > Appearance (modeRailPreferences.ts).
 * While it is on, screens and the games keep clear of it, and the old catalog/library side word (ViewRail) is not shown.
 * Stage: prototype.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useAppScreen } from "./appScreen";
import { useGameSection } from "./gameArea";
import { useI18n } from "./i18n";
import { defineModeRail } from "./components/ga/modeRail/gaModeRail";
import { railAttributes, useModeRail, type RailMode } from "./modeRailPreferences";
import "./mode-rail.css";

defineModeRail();

export const RAIL_LABELS: Record<"es" | "en", Record<RailMode, string>> = {
  es: { home: "HOME", catalog: "CATÁLOGO", library: "BIBLIOTECA", parental: "PARENTAL", settings: "AJUSTES" },
  en: { home: "HOME", catalog: "CATALOG", library: "LIBRARY", parental: "PARENTAL", settings: "SETTINGS" },
};

// A mode shown only while the settings try a look on another mode ("See it on").
let preview: RailMode | null = null;
const listeners = new Set<() => void>();
export function setRailPreview(mode: RailMode | null): void { if (preview === mode) return; preview = mode; listeners.forEach(listener => listener()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useRailPreview = () => useSyncExternalStore(subscribe, () => preview, () => preview);

/** The mode the frame has chosen: outside Home, Parental and Settings, the area of the games on screen (gameArea.ts). */
export function useRailMode(): RailMode {
  const screen = useAppScreen();
  const section = useGameSection();
  if (screen === "home") return "home";
  if (screen === "kids") return "parental";
  if (screen === "settings") return "settings";
  return section?.area ?? "catalog";
}

/**
 * True when the rail cannot be seen any more (custom CSS that hides it, makes it transparent or collapses it).
 * Computed styles are read always; sizes only where the page has a layout (the app's webview does).
 */
export function railHidden(rail: Element | null): boolean {
  if (!rail) return false;
  const hidden = (element: Element) => { const style = getComputedStyle(element); return style.display === "none" || style.visibility === "hidden" || Number.parseFloat(style.opacity) === 0; };
  if (hidden(rail)) return true;
  const word = rail.shadowRoot?.querySelector(".word") ?? null;
  if (word && hidden(word)) return true;
  if (document.documentElement.getBoundingClientRect().width > 0) {
    const box = rail.getBoundingClientRect();
    if (box.width < 8 || box.height < 40) return true;
    const text = word?.getBoundingClientRect();
    if (text && (text.width < 2 || text.height < 2)) return true;
  }
  return false;
}

export default function ModeRail() {
  const prefs = useModeRail();
  const current = useRailMode();
  const previewing = useRailPreview();
  const { locale } = useI18n();
  const slot = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement | null>(null);
  const mode = previewing ?? current;

  useLayoutEffect(() => {
    const host = slot.current;
    if (!prefs.enabled || !host) { rail.current?.remove(); rail.current = null; return; }
    const attrs = railAttributes(prefs, mode, RAIL_LABELS[locale === "en" ? "en" : "es"][mode]);
    // Everything but the mode first: a new mode starts the change animation with the rest already in place.
    const set = (element: HTMLElement, key: string) => { const value = attrs[key]; if (value === null) element.removeAttribute(key); else if (element.getAttribute(key) !== value) element.setAttribute(key, value); };
    let element = rail.current;
    if (!element) {
      element = document.createElement("ga-mode-rail");
      element.className = "ga-mode-rail";
      for (const key of Object.keys(attrs)) set(element, key);
      host.append(element);
      rail.current = element;
      return;
    }
    for (const key of Object.keys(attrs)) if (key !== "mode" && key !== "label") set(element, key);
    set(element, "label");
    set(element, "mode");
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!prefs.enabled) return;
    root.classList.add("ga-mode-rail-on");
    root.style.setProperty("--ga-mode-rail-w", `${prefs.width}px`);
    root.style.setProperty("--ga-rail-clear", "var(--ga-mode-rail-space)");
    return () => {
      root.classList.remove("ga-mode-rail-on");
      root.style.removeProperty("--ga-mode-rail-w");
      root.style.removeProperty("--ga-rail-clear");
    };
  }, [prefs.enabled, prefs.width]);

  useLayoutEffect(() => () => { rail.current?.remove(); rail.current = null; }, []);

  // On the page itself, like the screens (GaScreen): inside the app shell a scaled or transformed ancestor would
  // size and place the fixed rail by itself instead of by the window.
  return createPortal(<div ref={slot} className="ga-mode-rail-slot" />, document.body);
}
