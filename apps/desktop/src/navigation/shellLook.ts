/**
 * The look of the new shell, as the player sets it in Settings › Appearance (vault/Rediseño de navegación.md §5.13):
 * which of Styles 1–4 is on (a flavor stylesheet, templates/flavor-N.css), and any value the player changed on top of it.
 * A changed value is written as the same CSS variable the templates define, on the root, so the CSS stays the only
 * place that draws; a value left alone (null) is the style's or the base's. The mode bar's word keeps the extra choices
 * of the old rail (font, orientation, size, spacing, position and its GSAP animations). Saved like the rest of
 * Appearance: local storage, applied at once, announced with an event.
 */
import { useEffect, useState } from "react";
import { setStyleFlavor } from "../templates/flavor";

export const SHELL_LOOK_EVENT = "gameaccess:shell-look-changed";
export const SHELL_LOOK_KEY = "gameaccess:shell-look:v1";

export type ShellStyle = 1 | 2 | 3 | 4;
/** The animations of the mode bar's word (the old rail's set, components/ga/modeRail/gaModeRail.ts). */
export const WORD_ANIMATIONS = ["letters", "slide", "wipe", "decode", "fade", "none"] as const;
export type WordAnimation = (typeof WORD_ANIMATIONS)[number];
/** Fonts for the mode bar's word; "style" is the style's display font. All are packaged with the app. */
export const WORD_FONTS = ["style", "Bebas Neue", "Teko", "Saira Condensed", "Barlow Condensed", "Audiowide", "Manrope"] as const;
export type WordOrientation = "up" | "down" | "stacked";

/** A value of the templates the player can change: its CSS variable, the screen tab it lives on, and its range or choices. */
export type ShellParam =
  | { key: string; cssVar: string; tab: "style" | "details"; kind: "range"; min: number; max: number; step: number; unit: "px" | "s" | "" }
  | { key: string; cssVar: string; tab: "style" | "details"; kind: "choice"; options: readonly string[] };

export const SHELL_PARAMS = [
  // Style (the flavor's personality).
  { key: "railGraphic", cssVar: "--ga-nav-rail-graphic", tab: "style", kind: "choice", options: ["paper", "hazard", "circuit", "racing", "dots", "stripes", "checker", "plain"] },
  { key: "iconFill", cssVar: "--ga-nav-icon-fill", tab: "style", kind: "choice", options: ["flat", "duotone", "glass", "neon"] },
  { key: "displayCase", cssVar: "--ga-nav-display-case", tab: "style", kind: "choice", options: ["uppercase", "none"] },
  { key: "buttonCut", cssVar: "--ga-nav-button-cut", tab: "style", kind: "range", min: 0, max: 60, step: 1, unit: "px" },
  { key: "panelCorner", cssVar: "--ga-nav-panel-corner", tab: "style", kind: "range", min: 0, max: 40, step: 1, unit: "px" },
  { key: "glow", cssVar: "--ga-nav-glow", tab: "style", kind: "range", min: 0, max: 1, step: .05, unit: "" },
  { key: "grain", cssVar: "--ga-nav-grain-opacity", tab: "style", kind: "range", min: 0, max: .6, step: .02, unit: "" },
  { key: "scan", cssVar: "--ga-nav-scan-opacity", tab: "style", kind: "range", min: 0, max: 1, step: .05, unit: "" },
  { key: "transition", cssVar: "--ga-nav-transition-time", tab: "style", kind: "range", min: .15, max: 1.5, step: .05, unit: "s" },
  // Details (the pieces: the mode bar and the sections panel).
  { key: "modeWidth", cssVar: "--ga-nav-mode-w", tab: "details", kind: "range", min: 80, max: 180, step: 2, unit: "px" },
  { key: "bandHeight", cssVar: "--ga-nav-band-h", tab: "details", kind: "range", min: 70, max: 160, step: 2, unit: "px" },
  { key: "bandSlant", cssVar: "--ga-nav-mode-slant", tab: "details", kind: "range", min: 0, max: 60, step: 1, unit: "px" },
  { key: "panelCut", cssVar: "--ga-nav-panel-cut", tab: "details", kind: "range", min: 0, max: 120, step: 2, unit: "px" },
  { key: "panelImage", cssVar: "--ga-nav-panel-image-opacity", tab: "details", kind: "range", min: 0, max: 1, step: .05, unit: "" },
  { key: "panelTint", cssVar: "--ga-nav-panel-tint", tab: "details", kind: "range", min: 0, max: 1, step: .05, unit: "" },
  { key: "panelBlur", cssVar: "--ga-nav-panel-blur", tab: "details", kind: "range", min: 0, max: 12, step: .5, unit: "px" },
] as const satisfies readonly ShellParam[];
export type ShellParamKey = (typeof SHELL_PARAMS)[number]["key"];

export interface WordPrefs {
  font: (typeof WORD_FONTS)[number];
  /** Font size in px; null fits the word to the bar. */
  size: number | null;
  orientation: WordOrientation;
  /** Letter spacing in em; null lets the font decide. */
  tracking: number | null;
  align: "top" | "center" | "bottom";
  start: WordAnimation;
  end: WordAnimation;
  /** Seconds; null follows the style's transition time. */
  duration: number | null;
}

export interface ShellLook {
  style: ShellStyle;
  /** Values the player changed; a missing key is the style's. */
  values: Partial<Record<ShellParamKey, string | number>>;
  word: WordPrefs;
}

export const DEFAULT_WORD: WordPrefs = { font: "style", size: null, orientation: "up", tracking: null, align: "center", start: "letters", end: "slide", duration: null };
export const DEFAULT_SHELL_LOOK: ShellLook = { style: 1, values: {}, word: DEFAULT_WORD };

const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T => (list as readonly unknown[]).includes(value) ? value as T : fallback;
const clamp = (value: unknown, min: number, max: number): number | null => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;

export function normalizeShellLook(value: unknown): ShellLook {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const style = ([1, 2, 3, 4] as const).find(n => n === raw.style) ?? 1;
  const values: ShellLook["values"] = {};
  const rawValues = raw.values && typeof raw.values === "object" ? raw.values as Record<string, unknown> : {};
  for (const param of SHELL_PARAMS) {
    const v = rawValues[param.key];
    if (param.kind === "range") { const n = clamp(v, param.min, param.max); if (n !== null) values[param.key] = n; }
    else if (typeof v === "string" && (param.options as readonly string[]).includes(v)) values[param.key] = v;
  }
  const w = raw.word && typeof raw.word === "object" ? raw.word as Record<string, unknown> : {};
  const word: WordPrefs = {
    font: oneOf(w.font, WORD_FONTS, DEFAULT_WORD.font),
    size: w.size === null ? null : clamp(w.size, 40, 240),
    orientation: oneOf(w.orientation, ["up", "down", "stacked"] as const, DEFAULT_WORD.orientation),
    tracking: w.tracking === null ? null : clamp(w.tracking, -.2, .5),
    align: oneOf(w.align, ["top", "center", "bottom"] as const, DEFAULT_WORD.align),
    start: oneOf(w.start, WORD_ANIMATIONS, DEFAULT_WORD.start),
    end: oneOf(w.end, WORD_ANIMATIONS, DEFAULT_WORD.end),
    duration: w.duration === null ? null : clamp(w.duration, .15, 1.5),
  };
  return { style, values, word };
}

/** The CSS each changed value becomes: variable → value with its unit. */
export function shellLookVariables(look: ShellLook): Record<string, string> {
  const out: Record<string, string> = {};
  for (const param of SHELL_PARAMS) {
    const v = look.values[param.key];
    if (v === undefined) continue;
    out[param.cssVar] = param.kind === "range" ? `${v}${param.unit}` : String(v);
  }
  if (look.word.font !== "style") out["--ga-nav-word-family"] = `"${look.word.font}", "Arial Narrow", sans-serif`;
  if (look.word.tracking !== null) out["--ga-nav-word-tracking"] = `${look.word.tracking}em`;
  return out;
}

let applied: string[] = [];
/** Turns the style on and writes the changed values on the root; whatever an earlier call wrote and this one does not, is removed. */
export function applyShellLook(look: ShellLook, root: HTMLElement = document.documentElement): void {
  setStyleFlavor(`estilo-${look.style}`);
  const vars = shellLookVariables(look);
  for (const name of applied) if (!(name in vars)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applied = Object.keys(vars);
}

/** Takes the shell's look off the root (the old interface). */
export function clearShellLook(root: HTMLElement = document.documentElement): void {
  for (const name of applied) root.style.removeProperty(name);
  applied = [];
  setStyleFlavor(null);
}

export function loadShellLook(): ShellLook {
  try { return normalizeShellLook(JSON.parse(localStorage.getItem(SHELL_LOOK_KEY) || "null")); }
  catch { return { ...DEFAULT_SHELL_LOOK }; }
}

export function saveShellLook(look: ShellLook): ShellLook {
  const next = normalizeShellLook(look);
  try { localStorage.setItem(SHELL_LOOK_KEY, JSON.stringify(next)); } catch { /* the look still applies for this session */ }
  window.dispatchEvent(new CustomEvent(SHELL_LOOK_EVENT, { detail: next }));
  return next;
}

export function useShellLook(): ShellLook {
  const [look, setLook] = useState(loadShellLook);
  useEffect(() => {
    const update = (event: Event) => setLook((event as CustomEvent<ShellLook>).detail ?? loadShellLook());
    window.addEventListener(SHELL_LOOK_EVENT, update);
    return () => window.removeEventListener(SHELL_LOOK_EVENT, update);
  }, []);
  return look;
}

/** The value a variable has now on the root (the style's or the player's): what a control shows before it is moved. */
export function currentCssValue(cssVar: string, root: HTMLElement = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(cssVar).trim();
}
