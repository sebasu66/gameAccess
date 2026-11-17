/**
 * The user's choices for the mode rail (<ga-mode-rail>, the large vertical word of the current mode), saved like the
 * rest of Settings > Appearance (pixelStylePreferences.ts): in the app's local storage, applied at once, announced with
 * an event. railAttributes() turns them into the element's attributes. Stage: prototype.
 */
import { useEffect, useState } from "react";

export const MODE_RAIL_EVENT = "gameaccess:mode-rail-changed";
export const MODE_RAIL_KEY = "gameaccess:mode-rail:v1";

/** The frame's modes: Home, the two areas of the games (gameArea.ts: Catalog, Library), Parental and Settings. */
export type RailMode = "home" | "catalog" | "library" | "parental" | "settings";
export const RAIL_MODE_ORDER: RailMode[] = ["home", "catalog", "library", "parental", "settings"];
export type RailAnimation = "none" | "slide" | "letters" | "wipe" | "decode" | "fade";
export const RAIL_ANIMATIONS: RailAnimation[] = ["slide", "letters", "wipe", "decode", "fade", "none"];
export type RailBackground = "none" | "caps" | "strips" | "custom";
export const RAIL_FONTS = ["Bebas Neue", "Archivo Black", "Audiowide", "Manrope"] as const;
export const RAIL_BLENDS = ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "color-burn", "luminosity", "color", "darken", "lighten"] as const;
/** The images that come with the app (public/mode-rail). */
export const RAIL_IMAGES: Record<"caps" | "strips", string> = { caps: "/mode-rail/caps.png", strips: "/mode-rail/strips.jpg" };

export interface ModeRailPrefs {
  enabled: boolean;
  width: number;
  font: string;
  /** Font size in px; null fits the word to the rail. */
  size: number | null;
  orientation: "up" | "down" | "stacked";
  /** Space between letters in em; null lets the orientation decide. */
  tracking: number | null;
  align: "top" | "center" | "bottom";
  offset: number;
  start: RailAnimation;
  end: RailAnimation;
  duration: number;
  fill: "color" | "image";
  /** Text colour; null: dark, or light over a dark cap. */
  ink: string | null;
  inkOpacity: number;
  stroke: string;
  strokeWidth: number;
  hazard: boolean;
  background: RailBackground;
  /** The user's own image (a data URL) when background is "custom". */
  backgroundData: string | null;
  format: "auto" | "strips" | "caps";
  strips: number;
  blend: string;
  contrast: number;
  brightness: number;
  saturate: number;
  opacity: number;
  behind: boolean;
  /** Rail colour; null takes it from the cap. */
  railColor: string | null;
  css: string;
}

export const DEFAULT_MODE_RAIL: ModeRailPrefs = {
  enabled: true, width: 112, font: "Bebas Neue", size: null, orientation: "up", tracking: null, align: "center", offset: 0,
  start: "letters", end: "slide", duration: .6, fill: "color", ink: null, inkOpacity: 1, stroke: "#f4f1ea", strokeWidth: 0, hazard: true,
  background: "caps", backgroundData: null, format: "auto", strips: 5, blend: "normal", contrast: 1, brightness: 1, saturate: 1, opacity: 1,
  behind: false, railColor: null, css: "",
};

const RANGES = {
  width: [72, 180], size: [40, 320], tracking: [-.4, .4], offset: [-400, 400], duration: [.15, 1.5], inkOpacity: [0, 1], strokeWidth: [0, 8],
  strips: [1, 8], contrast: [0, 2], brightness: [0, 2], saturate: [0, 2], opacity: [0, 1],
} as const;
type Ranged = keyof typeof RANGES;
const COLOR = /^#[0-9a-f]{6}$/i;
const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T => (list as readonly unknown[]).includes(value) ? value as T : fallback;

export function normalizeModeRail(value: unknown): ModeRailPrefs {
  const next: ModeRailPrefs = { ...DEFAULT_MODE_RAIL };
  if (!value || typeof value !== "object") return next;
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(RANGES) as Ranged[]) {
    const n = raw[key];
    if (typeof n === "number" && Number.isFinite(n)) (next as unknown as Record<string, number>)[key] = Math.min(RANGES[key][1], Math.max(RANGES[key][0], n));
    else if (n === null && (key === "size" || key === "tracking")) next[key] = null;
  }
  next.strips = Math.round(next.strips);
  for (const key of ["enabled", "hazard", "behind"] as const) if (typeof raw[key] === "boolean") next[key] = raw[key] as boolean;
  if (typeof raw.font === "string" && raw.font.trim()) next.font = raw.font.trim().slice(0, 80);
  next.orientation = oneOf(raw.orientation, ["up", "down", "stacked"] as const, next.orientation);
  next.align = oneOf(raw.align, ["top", "center", "bottom"] as const, next.align);
  next.start = oneOf(raw.start, RAIL_ANIMATIONS, next.start);
  next.end = oneOf(raw.end, RAIL_ANIMATIONS, next.end);
  next.fill = oneOf(raw.fill, ["color", "image"] as const, next.fill);
  next.background = oneOf(raw.background, ["none", "caps", "strips", "custom"] as const, next.background);
  next.format = oneOf(raw.format, ["auto", "strips", "caps"] as const, next.format);
  next.blend = oneOf(raw.blend, RAIL_BLENDS, "normal");
  next.ink = typeof raw.ink === "string" && COLOR.test(raw.ink) ? raw.ink : null;
  next.railColor = typeof raw.railColor === "string" && COLOR.test(raw.railColor) ? raw.railColor : null;
  if (typeof raw.stroke === "string" && COLOR.test(raw.stroke)) next.stroke = raw.stroke;
  next.backgroundData = typeof raw.backgroundData === "string" && raw.backgroundData.startsWith("data:image/") ? raw.backgroundData : null;
  if (next.background === "custom" && !next.backgroundData) next.background = DEFAULT_MODE_RAIL.background;
  if (typeof raw.css === "string") next.css = raw.css;
  return next;
}

export function loadModeRail(): ModeRailPrefs {
  try { return normalizeModeRail(JSON.parse(localStorage.getItem(MODE_RAIL_KEY) || "null")); }
  catch { return { ...DEFAULT_MODE_RAIL }; }
}

/** Saves and announces the choice. False when it could not be stored (an image too large for the app's storage). */
export function saveModeRail(value: ModeRailPrefs): boolean {
  const next = normalizeModeRail(value);
  let stored = true;
  try { localStorage.setItem(MODE_RAIL_KEY, JSON.stringify(next)); } catch { stored = false; }
  window.dispatchEvent(new CustomEvent(MODE_RAIL_EVENT, { detail: next }));
  return stored;
}

export function useModeRail(): ModeRailPrefs {
  const [prefs, setPrefs] = useState(loadModeRail);
  useEffect(() => {
    const update = (event: Event) => setPrefs((event as CustomEvent<ModeRailPrefs>).detail ?? loadModeRail());
    window.addEventListener(MODE_RAIL_EVENT, update);
    return () => window.removeEventListener(MODE_RAIL_EVENT, update);
  }, []);
  return prefs;
}

export function railImage(prefs: ModeRailPrefs): string | null {
  if (prefs.background === "custom") return prefs.backgroundData;
  return prefs.background === "none" ? null : RAIL_IMAGES[prefs.background];
}

/** The element's attributes for these choices (null removes the attribute). */
export function railAttributes(prefs: ModeRailPrefs, mode: RailMode, label: string): Record<string, string | null> {
  const image = railImage(prefs);
  const n = (value: number) => String(Math.round(value * 100) / 100);
  return {
    mode, label, font: prefs.font, size: prefs.size === null ? null : n(prefs.size), orientation: prefs.orientation,
    tracking: prefs.tracking === null ? null : n(prefs.tracking), align: prefs.align, offset: prefs.offset ? n(prefs.offset) : null,
    start: prefs.start, end: prefs.end, duration: n(prefs.duration), fill: prefs.fill === "image" ? "image" : null,
    ink: prefs.ink, "ink-opacity": prefs.inkOpacity < 1 ? n(prefs.inkOpacity) : null,
    stroke: prefs.strokeWidth > 0 ? prefs.stroke : null, "stroke-width": prefs.strokeWidth > 0 ? n(prefs.strokeWidth) : null,
    hazard: prefs.hazard ? null : "off", bg: image,
    "bg-format": image && prefs.format !== "auto" ? prefs.format : null, "bg-strips": image ? String(prefs.strips) : null,
    "bg-blend": image ? prefs.blend : null, "bg-contrast": image ? n(prefs.contrast) : null, "bg-brightness": image ? n(prefs.brightness) : null,
    "bg-saturate": image ? n(prefs.saturate) : null, "bg-opacity": image ? n(prefs.opacity) : null, "bg-behind": prefs.behind ? "on" : null,
    "rail-color": prefs.railColor, css: prefs.css || null,
  };
}
