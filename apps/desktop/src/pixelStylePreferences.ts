export const PIXEL_STYLE_EVENT = "gameaccess:pixel-style-changed";
export const PIXEL_STYLE_KEY = "gameaccess:pixel-style:v1";
export const STYLE_RANGES = {
  spd: [.2, 3, .1], cob: [0, 1.6, .05], blink: [0, 2.5, .1],
  ovar: [0, 2.5, .05], oled: [0, 2, .05], glass: [0, 1, .01],
} as const;
export type StyleParam = keyof typeof STYLE_RANGES;
export interface PixelStyle { spd: number; cob: number; blink: number; ovar: number; oled: number; glass: number; animate: boolean }
export const DEFAULT_PIXEL_STYLE: PixelStyle = { spd: 1, cob: 1, blink: 1, ovar: 1.4, oled: 1, glass: .85, animate: true };
export function normalizePixelStyle(value: unknown): PixelStyle {
  const next = { ...DEFAULT_PIXEL_STYLE };
  if (!value || typeof value !== "object") return next;
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(STYLE_RANGES) as StyleParam[]) {
    const n = raw[key];
    if (typeof n === "number" && Number.isFinite(n)) next[key] = Math.min(STYLE_RANGES[key][1], Math.max(STYLE_RANGES[key][0], n));
  }
  if (typeof raw.animate === "boolean") next.animate = raw.animate;
  return next;
}
export function loadPixelStyle(): PixelStyle {
  try { return normalizePixelStyle(JSON.parse(localStorage.getItem(PIXEL_STYLE_KEY) || "null")); }
  catch { return { ...DEFAULT_PIXEL_STYLE }; }
}
export function savePixelStyle(value: PixelStyle): void {
  const next = normalizePixelStyle(value);
  try { localStorage.setItem(PIXEL_STYLE_KEY, JSON.stringify(next)); } catch { /* keep live controls usable */ }
  window.dispatchEvent(new CustomEvent(PIXEL_STYLE_EVENT, { detail: next }));
}
