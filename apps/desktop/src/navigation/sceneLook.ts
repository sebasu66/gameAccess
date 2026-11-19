/**
 * What the player can change of Escena (Settings › Appearance, and right-click on the scene; Seba 2026-11-16): one
 * gradient per mode (a ready palette or two colours of their own; the dark tone derives from it), the figure of each
 * mode (their own image, its scale and position) and the font of the big word. Nothing else, so the style holds.
 * The menu's text turns black or white by itself, whichever stands out more on the gradient. Up to three variations
 * can be saved and put back; "default" goes back to the original. Images live in IndexedDB (they are too big for
 * local storage); the look keeps only their id.
 */
import { useEffect, useState } from "react";

export const SCENE_MODES = ["catalog", "library", "gameAccess", "settings"] as const;
export type SceneMode = (typeof SCENE_MODES)[number];
export interface SceneGradient { from: string; to: string }
export interface SceneFigure { image: string | null; scale: number; x: number; y: number }
export const SCENE_WORD_FONTS = ["Anton", "Bebas Neue", "Teko", "Saira Condensed", "Barlow Condensed", "Audiowide"] as const;
export type SceneWordFont = (typeof SCENE_WORD_FONTS)[number];
export interface SceneLook {
  /** A missing mode keeps its original gradient. */
  gradients: Partial<Record<SceneMode, SceneGradient>>;
  /** A missing mode keeps its original figure, at its place. */
  figures: Partial<Record<SceneMode, SceneFigure>>;
  wordFont: SceneWordFont;
}
export interface SceneVariation { id: string; name: string; scene: SceneLook }
export const MAX_SCENE_VARIATIONS = 3;
export const DEFAULT_SCENE: SceneLook = { gradients: {}, figures: {}, wordFont: "Anton" };
export const DEFAULT_FIGURE: SceneFigure = { image: null, scale: 1, x: 0, y: 0 };
export const FIGURE_LIMITS = { scale: [.6, 1.5, .02], x: [-40, 40, 1], y: [-30, 30, 1] } as const;

/** The original gradients, written as two colours (the CSS derives them from one; these are what the pickers show). */
export const DEFAULT_GRADIENTS: Record<SceneMode, SceneGradient> = {
  catalog: { from: "#fdda60", to: "#ff864b" },
  library: { from: "#ff6c51", to: "#cd2a9b" },
  gameAccess: { from: "#88c1ff", to: "#00a8c2" },
  settings: { from: "#5affd2", to: "#a2c31c" },
};
/** The figure files that ship with the app. */
export const SCENE_FIGURE_FILES: Record<SceneMode, string> = { catalog: "catalogo", library: "libreria", gameAccess: "gameaccess", settings: "config" };
/** What a player's figure has to match: the original's size and shape, with a transparent background. */
export const FIGURE_SIZE = { width: 1024, height: 1536 } as const;

/** Gradients chosen to look good under the menu, any mode can take any of them. */
export const SCENE_GRADIENTS = [
  { id: "amber", from: "#fdda60", to: "#ff864b" }, { id: "coral", from: "#ff6c51", to: "#cd2a9b" },
  { id: "sky", from: "#88c1ff", to: "#00a8c2" }, { id: "mint", from: "#5affd2", to: "#a2c31c" },
  { id: "sunset", from: "#ffb347", to: "#ff4e7a" }, { id: "lavender", from: "#c9b6ff", to: "#7b5cff" },
  { id: "lime", from: "#e4ff5c", to: "#3ccf6e" }, { id: "rose", from: "#ffb3d1", to: "#ff5c8a" },
  { id: "ocean", from: "#5ee7ff", to: "#3a5bff" }, { id: "ember", from: "#ff8a3d", to: "#c4161c" },
  { id: "ice", from: "#f2fbff", to: "#9fd3ff" }, { id: "night", from: "#4b3f8f", to: "#141a3a" },
] as const;
export type SceneGradientId = (typeof SCENE_GRADIENTS)[number]["id"];
/** Whole palettes: one gradient for each of the four modes. */
export const SCENE_PALETTES: Record<string, Record<SceneMode, SceneGradientId>> = {
  original: { catalog: "amber", library: "coral", gameAccess: "sky", settings: "mint" },
  neon: { catalog: "lime", library: "rose", gameAccess: "ocean", settings: "lavender" },
  warm: { catalog: "sunset", library: "ember", gameAccess: "rose", settings: "amber" },
  cool: { catalog: "ice", library: "lavender", gameAccess: "ocean", settings: "mint" },
};

const HEX = /^#[0-9a-f]{6}$/i;
const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const toHex = (values: number[]) => `#${values.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
/** The colour halfway: the mode's colour (its frame, its word, its icons). */
export const mixHex = (a: string, b: string) => toHex(channels(a).map((value, index) => (value + channels(b)[index]) / 2));
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
};
/** Black or white text for a gradient: the one whose worst contrast along it is better. */
export function inkFor(gradient: SceneGradient): "dark" | "light" {
  const stops = [gradient.from, mixHex(gradient.from, gradient.to), gradient.to].map(luminance);
  const onDark = Math.min(...stops.map(l => (l + .05) / .05)), onLight = Math.min(...stops.map(l => 1.05 / (l + .05)));
  return onDark >= onLight ? "dark" : "light";
}

const clamp = (value: unknown, [min, max]: readonly [number, number, number], fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const record = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};

export function normalizeScene(value: unknown): SceneLook {
  const raw = record(value), rawGradients = record(raw.gradients), rawFigures = record(raw.figures);
  const gradients: SceneLook["gradients"] = {}, figures: SceneLook["figures"] = {};
  for (const mode of SCENE_MODES) {
    const g = record(rawGradients[mode]);
    if (typeof g.from === "string" && typeof g.to === "string" && HEX.test(g.from) && HEX.test(g.to)) gradients[mode] = { from: g.from.toLowerCase(), to: g.to.toLowerCase() };
    if (!rawFigures[mode]) continue;
    const f = record(rawFigures[mode]);
    const figure: SceneFigure = {
      image: typeof f.image === "string" && /^img-[\w-]{1,40}$/.test(f.image) ? f.image : null,
      scale: clamp(f.scale, FIGURE_LIMITS.scale, 1), x: clamp(f.x, FIGURE_LIMITS.x, 0), y: clamp(f.y, FIGURE_LIMITS.y, 0),
    };
    if (figure.image || figure.scale !== 1 || figure.x || figure.y) figures[mode] = figure;
  }
  const wordFont = (SCENE_WORD_FONTS as readonly unknown[]).includes(raw.wordFont) ? raw.wordFont as SceneWordFont : "Anton";
  return { gradients, figures, wordFont };
}

export function normalizeVariations(value: unknown): SceneVariation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_SCENE_VARIATIONS).flatMap((entry, index) => {
    const raw = record(entry);
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : `${index + 1}`;
    const id = typeof raw.id === "string" && raw.id ? raw.id.slice(0, 40) : `v${index + 1}`;
    return raw.scene ? [{ id, name, scene: normalizeScene(raw.scene) }] : [];
  });
}

const cssMode = (mode: SceneMode) => mode === "gameAccess" ? "game-access" : mode;
/** The CSS variables a scene look becomes on the root; a mode left alone writes nothing and keeps the flavor's. */
export function sceneVariables(scene: SceneLook): Record<string, string> {
  const out: Record<string, string> = {};
  for (const mode of SCENE_MODES) {
    const gradient = scene.gradients[mode];
    if (!gradient) continue;
    const name = `--ga-scene-${cssMode(mode)}`;
    out[name] = mixHex(gradient.from, gradient.to);
    out[`${name}-start`] = gradient.from;
    out[`${name}-end`] = gradient.to;
    out[`${name}-ink`] = `var(--ga-scene-ink-${inkFor(gradient)})`;
  }
  if (scene.wordFont !== "Anton") out["--ga-scene-word-family"] = `"${scene.wordFont}", var(--ga-scene-display-family)`;
  return out;
}

/** Image ids a scene look and its saved variations still use; any other stored image can go. */
export const usedImages = (scenes: SceneLook[]) => new Set(scenes.flatMap(scene => Object.values(scene.figures).map(figure => figure?.image).filter((id): id is string => Boolean(id))));

// ---- The player's figures (IndexedDB) ----

const DB = "gameaccess-scene", STORE = "figures";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB is not available")); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

const urls = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();
export const FIGURE_IMAGE_EVENT = "gameaccess:scene-figure-image";

/** An object URL for a stored figure, or null when it is gone. */
export function figureImageUrl(id: string): Promise<string | null> {
  const known = urls.get(id);
  if (known) return Promise.resolve(known);
  let pending = loading.get(id);
  if (!pending) {
    pending = withStore<Blob | undefined>("readonly", store => store.get(id) as IDBRequest<Blob | undefined>)
      .then(blob => { if (!blob) return null; const url = URL.createObjectURL(blob); urls.set(id, url); return url; })
      .catch(() => null)
      .finally(() => loading.delete(id));
    loading.set(id, pending);
  }
  return pending;
}

/** A stored figure's own file, to measure it again; null when it is gone. */
export function figureImageBlob(id: string): Promise<Blob | null> {
  return withStore<Blob | undefined>("readonly", store => store.get(id) as IDBRequest<Blob | undefined>)
    .then(blob => blob ?? null).catch(() => null);
}

/** The src for a mode's figure: the player's image once it loads, otherwise the original. */
export function useFigureSrc(mode: SceneMode, image: string | null | undefined): string {
  const original = `/styles/escena/fig-${SCENE_FIGURE_FILES[mode]}-vertical.webp`;
  const [src, setSrc] = useState(() => image ? urls.get(image) ?? original : original);
  useEffect(() => {
    if (!image) { setSrc(original); return; }
    let live = true;
    void figureImageUrl(image).then(url => { if (live) setSrc(url ?? original); });
    const reload = () => void figureImageUrl(image).then(url => { if (live) setSrc(url ?? original); });
    window.addEventListener(FIGURE_IMAGE_EVENT, reload);
    return () => { live = false; window.removeEventListener(FIGURE_IMAGE_EVENT, reload); };
  }, [image, original]);
  return src;
}

/** Why an image cannot be a figure (a translation key), or its size when it can. */
export type FigureCheck = { ok: true; width: number; height: number; exact: boolean } | { ok: false; reason: "lookFigureNotImage" | "lookFigureTooBig" | "lookFigureShape" | "lookFigureOpaque" };
export const MAX_FIGURE_BYTES = 12 * 1024 * 1024;

/** Checks a new figure: an image, not too heavy, the original's proportion (2:3) and a transparent background. */
export async function checkFigure(blob: Blob): Promise<FigureCheck> {
  if (!/^image\/(png|webp|gif|avif)$/.test(blob.type)) return { ok: false, reason: blob.type.startsWith("image/") ? "lookFigureOpaque" : "lookFigureNotImage" };
  if (blob.size > MAX_FIGURE_BYTES) return { ok: false, reason: "lookFigureTooBig" };
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || Math.abs(width / height - FIGURE_SIZE.width / FIGURE_SIZE.height) > .02 * FIGURE_SIZE.width / FIGURE_SIZE.height) return { ok: false, reason: "lookFigureShape" };
    // A transparent background: a good part of a small copy has (almost) no alpha.
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 48;
    const context = canvas.getContext("2d");
    if (context) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let clear = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 16) clear++;
      if (clear < canvas.width * canvas.height * .08) return { ok: false, reason: "lookFigureOpaque" };
    }
    return { ok: true, width, height, exact: width === FIGURE_SIZE.width && height === FIGURE_SIZE.height };
  } catch {
    return { ok: false, reason: "lookFigureNotImage" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Where a figure lands by itself when it is dropped (Seba, 2026-11-19), so every image reaches the same place however
 * much transparent room it carries around the drawing: its drawing's **top right corner** goes to the art's corner and
 * its height is always the same. In shares of the art's own height (`--ga-scene-art-height`).
 */
export const FIGURE_FIT = { top: 0, right: 0, height: 1.25 } as const;
/** The box the figure is placed in: the scene's column, and the art's height inside it, all in pixels. */
export interface FigureFrame { width: number; height: number; art: number }
/** The drawing inside an image: what is not transparent, as shares of the image, with the image's own size. */
export interface FigureBox { top: number; right: number; bottom: number; width: number; height: number }

/** The scene column as a frame, read off the live element; null when the scene is not on screen. */
export function figureFrame(scene: Element | null = document.querySelector(".ga-scene-navigation")): FigureFrame | null {
  if (!scene) return null;
  const rect = scene.getBoundingClientRect();
  const art = parseFloat(getComputedStyle(scene).getPropertyValue("--ga-scene-art-height"));
  return rect.width && rect.height && art ? { width: rect.width, height: rect.height, art } : null;
}

/** Measures the drawing inside an image: the smallest box that holds everything that is not transparent. */
export async function figureBox(blob: Blob): Promise<FigureBox | null> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 96;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !image.naturalWidth || !image.naturalHeight) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let top = canvas.height, right = -1, bottom = -1;
    for (let row = 0; row < canvas.height; row++) for (let column = 0; column < canvas.width; column++) {
      if (pixels[(row * canvas.width + column) * 4 + 3] < 24) continue;
      if (row < top) top = row;
      if (row > bottom) bottom = row;
      if (column > right) right = column;
    }
    if (bottom < 0) return null;                       // nothing but transparency
    return { top: top / canvas.height, bottom: (bottom + 1) / canvas.height, right: (right + 1) / canvas.width,
      width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The scale and the place that put a drawing at `FIGURE_FIT`, in the same numbers the sliders use, so the player can
 * go on moving it by hand afterwards. It undoes the geometry of `.ga-scene-art img` (scene-frame.css): the image is
 * `art * scale` tall, hung from the art's top and from the column's right edge, and both offsets are shares of the
 * column, not of the image.
 */
export function fitFigure(box: FigureBox, frame: FigureFrame): Pick<SceneFigure, "scale" | "x" | "y"> {
  const [low, high, step] = FIGURE_LIMITS.scale;
  const drawn = Math.max(box.bottom - box.top, .05);
  const scale = Math.min(high, Math.max(low, Math.round(FIGURE_FIT.height / drawn / step) * step));
  const tall = frame.art * scale, wide = tall * box.width / box.height;
  const top = FIGURE_FIT.top * frame.art - (1 - scale) * frame.art * .8 - box.top * tall;
  const right = (1 - scale) * frame.art / 3 + (1 - box.right) * wide - FIGURE_FIT.right * frame.art;
  const hold = (value: number, limits: readonly [number, number, number]) =>
    Math.min(limits[1], Math.max(limits[0], Math.round(value / limits[2]) * limits[2]));
  return { scale, x: hold(right / frame.width * 100, FIGURE_LIMITS.x), y: hold(top / frame.height * 100, FIGURE_LIMITS.y) };
}

/** Stores a checked figure and returns its id. */
export async function storeFigure(blob: Blob): Promise<string> {
  const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await withStore("readwrite", store => store.put(blob, id));
  return id;
}

/** Removes stored figures nothing uses any more (after a change, a reset or a deleted variation). */
export async function dropUnusedFigures(keep: Set<string>): Promise<void> {
  try {
    const keys = await withStore<IDBValidKey[]>("readonly", store => store.getAllKeys());
    for (const key of keys) {
      if (typeof key !== "string" || keep.has(key)) continue;
      await withStore("readwrite", store => store.delete(key));
      const url = urls.get(key);
      if (url) { URL.revokeObjectURL(url); urls.delete(key); }
    }
  } catch { /* nothing to clean */ }
}
