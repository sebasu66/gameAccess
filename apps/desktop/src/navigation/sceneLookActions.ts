/**
 * The changes the player (or the AI, mcp/appearanceTools.ts) can make to Escena: one place, so the right-click menus,
 * Settings › Appearance and the MCP tools save the same way (shellLook.ts, sceneLook.ts).
 */
import { loadShellLook, saveShellLook, type ShellLook } from "./shellLook";
import {
  DEFAULT_FIGURE, DEFAULT_SCENE, FIGURE_IMAGE_EVENT, MAX_SCENE_VARIATIONS, SCENE_GRADIENTS, SCENE_MODES, SCENE_PALETTES, checkFigure, figureBox,
  figureFrame, figureImageBlob, fitFigure, storeFigure,
  type FigureCheck, type SceneFigure, type SceneGradient, type SceneLook, type SceneMode, type SceneWordFont,
} from "./sceneLook";

const saveScene = (change: (scene: SceneLook, look: ShellLook) => SceneLook): ShellLook => {
  const look = loadShellLook();
  return saveShellLook({ ...look, scene: change(look.scene, look) });
};

/** A mode's gradient; null goes back to the original. */
export function setSceneGradient(mode: SceneMode, gradient: SceneGradient | null): ShellLook {
  return saveScene(scene => {
    const gradients = { ...scene.gradients };
    if (gradient) gradients[mode] = gradient; else delete gradients[mode];
    return { ...scene, gradients };
  });
}

/** A whole palette, one gradient per mode; "original" takes every mode back to its own. */
export function setScenePalette(id: string): ShellLook {
  const palette = SCENE_PALETTES[id];
  if (!palette) throw new Error(`Unknown palette ${id}`);
  return saveScene(scene => {
    if (id === "original") return { ...scene, gradients: {} };
    const gradients: SceneLook["gradients"] = {};
    for (const mode of SCENE_MODES) {
      const preset = SCENE_GRADIENTS.find(entry => entry.id === palette[mode])!;
      gradients[mode] = { from: preset.from, to: preset.to };
    }
    return { ...scene, gradients };
  });
}

/** Scale or move a mode's figure; null takes it back to the original image at its place. */
export function setSceneFigure(mode: SceneMode, patch: Partial<SceneFigure> | null): ShellLook {
  return saveScene(scene => {
    const figures = { ...scene.figures };
    if (patch) figures[mode] = { ...DEFAULT_FIGURE, ...figures[mode], ...patch }; else delete figures[mode];
    return { ...scene, figures };
  });
}

/**
 * Checks and stores a new figure for a mode. With `fit` it is also **placed by itself** (Seba, 2026-11-19): the
 * drawing's top right corner goes to the art's corner and its height is always the same, whatever transparent room
 * the image carries, so a dropped image lands where the eye expects it. Without it the mode keeps its scale and
 * place. Either way the player can go on moving it by hand with the sliders afterwards.
 */
export async function setSceneFigureImage(mode: SceneMode, blob: Blob, fit = false): Promise<FigureCheck> {
  const check = await checkFigure(blob);
  if (!check.ok) return check;
  const image = await storeFigure(blob);
  const frame = fit ? figureFrame() : null;
  const box = frame ? await figureBox(blob) : null;
  setSceneFigure(mode, box && frame ? { image, ...fitFigure(box, frame) } : { image });
  window.dispatchEvent(new Event(FIGURE_IMAGE_EVENT));
  return check;
}

/** Places the figure a mode already has by itself, the same way a dropped one is placed. True when it could. */
export async function fitSceneFigure(mode: SceneMode): Promise<boolean> {
  const image = loadShellLook().scene.figures[mode]?.image;
  const frame = figureFrame();
  const blob = image ? await figureImageBlob(image) : null;
  const box = blob && frame ? await figureBox(blob) : null;
  if (!box || !frame) return false;
  setSceneFigure(mode, fitFigure(box, frame));
  return true;
}

export const setSceneWordFont = (wordFont: SceneWordFont): ShellLook => saveScene(scene => ({ ...scene, wordFont }));

/** Everything of Escena back to the original (saved variations stay). */
export function resetScene(): ShellLook {
  const look = loadShellLook();
  return saveShellLook({ ...look, scene: DEFAULT_SCENE, sceneTone: "light" });
}

/** Saves what is on now as a variation; with three saved, one has to be deleted first. */
export function saveSceneVariation(name: string): ShellLook {
  const look = loadShellLook();
  if (look.variations.length >= MAX_SCENE_VARIATIONS) throw new Error("full");
  const id = `v${Date.now().toString(36)}`;
  return saveShellLook({ ...look, variations: [...look.variations, { id, name: name.trim() || String(look.variations.length + 1), scene: look.scene }] });
}

export function applySceneVariation(id: string): ShellLook {
  const look = loadShellLook();
  const variation = look.variations.find(entry => entry.id === id);
  if (!variation) throw new Error(`No variation ${id}`);
  return saveShellLook({ ...look, scene: variation.scene });
}

export function deleteSceneVariation(id: string): ShellLook {
  const look = loadShellLook();
  return saveShellLook({ ...look, variations: look.variations.filter(entry => entry.id !== id) });
}

export const setSceneTone = (sceneTone: "light" | "dark"): ShellLook => saveShellLook({ ...loadShellLook(), sceneTone });
