/**
 * Escena's look through MCP (Settings › Appearance, navigation/sceneLook.ts): read it, change a mode's gradient, a
 * whole palette, the tone, the big word's font or a figure, save and use up to three variations, and go back to the
 * default. The same actions as the right-click menus and Settings (navigation/sceneLookActions.ts), so trying them here
 * tries the app too. Nothing here is destructive beyond the player's own look; deleting a variation is undone by saving
 * it again.
 */
import { translate, type TranslationKey } from "../i18n";
import { loadShellLook, type ShellLook } from "../navigation/shellLook";
import {
  DEFAULT_GRADIENTS, FIGURE_LIMITS, FIGURE_SIZE, MAX_SCENE_VARIATIONS, SCENE_GRADIENTS, SCENE_MODES, SCENE_PALETTES, SCENE_WORD_FONTS,
  inkFor, type SceneGradient, type SceneMode, type SceneWordFont,
} from "../navigation/sceneLook";
import {
  applySceneVariation, deleteSceneVariation, resetScene, saveSceneVariation, setSceneFigure, setSceneFigureImage, setSceneGradient,
  setScenePalette, setSceneTone, setSceneWordFont,
} from "../navigation/sceneLookActions";
import { logAction } from "./confirm";
import { bool, num, str, ToolError, type McpTool } from "./tools";

const HEX = /^#[0-9a-f]{6}$/i;
const modeArg = (args: Record<string, unknown>): SceneMode => {
  const mode = str(args, "mode");
  if (!mode || !(SCENE_MODES as readonly string[]).includes(mode)) throw new ToolError(`"mode" must be one of ${SCENE_MODES.join(", ")}.`);
  return mode as SceneMode;
};

/** The look as the AI sees it: what each mode shows now, the player's own changes marked, and what can be chosen. */
function describe(look: ShellLook = loadShellLook()) {
  const scene = look.scene;
  return {
    tone: look.sceneTone,
    modes: Object.fromEntries(SCENE_MODES.map(mode => {
      const gradient: SceneGradient = scene.gradients[mode] ?? DEFAULT_GRADIENTS[mode];
      const figure = scene.figures[mode];
      return [mode, {
        gradient: { ...gradient, own: Boolean(scene.gradients[mode]), preset: SCENE_GRADIENTS.find(entry => entry.from === gradient.from && entry.to === gradient.to)?.id ?? null },
        menu_text: inkFor(gradient) === "dark" ? "black" : "white",
        figure: { own_image: Boolean(figure?.image), scale: figure?.scale ?? 1, x_percent: figure?.x ?? 0, y_percent: figure?.y ?? 0 },
      }];
    })),
    word_font: scene.wordFont,
    variations: look.variations.map(variation => ({ id: variation.id, name: variation.name })),
    can_save_variation: look.variations.length < MAX_SCENE_VARIATIONS,
    options: {
      gradient_presets: SCENE_GRADIENTS.map(entry => ({ id: entry.id, from: entry.from, to: entry.to })),
      palettes: Object.keys(SCENE_PALETTES), word_fonts: SCENE_WORD_FONTS,
      figure: { scale: FIGURE_LIMITS.scale.slice(0, 2), x_percent: FIGURE_LIMITS.x.slice(0, 2), y_percent: FIGURE_LIMITS.y.slice(0, 2),
        image: `PNG or WebP, ${FIGURE_SIZE.width}×${FIGURE_SIZE.height} (2:3), transparent background, up to 12 MB` },
      max_variations: MAX_SCENE_VARIATIONS,
    },
  };
}

export const appearanceTools: McpTool[] = [
  {
    name: "appearance_get",
    title: "Escena's look",
    description: "How Escena looks now (Settings › Appearance): the tone (light/dark), each mode's gradient (catalog, library, gameAccess, settings; `own` when the player changed it) and whether its menu text is black or white (chosen for contrast on its own), each mode's figure (own image, scale, position), the big word's font, the saved variations (up to 3) and every choice available.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async () => describe(),
  },
  {
    name: "appearance_set_colors",
    title: "Change Escena's colours or font",
    description: "Changes Escena's colours: `palette` sets all four modes at once (original takes them all back); or `mode` with `preset` (a gradient id from appearance_get) or `from`+`to` (#rrggbb) for one mode, or `original: true` to take that mode back. Also `tone` (light/dark; dark is derived from each gradient) and `word_font`. The menu's text colour follows by itself. `reset: true` takes everything of Escena back to the default (saved variations stay). Applies and saves at once.",
    inputSchema: { type: "object", properties: {
      palette: { type: "string", enum: Object.keys(SCENE_PALETTES) },
      mode: { type: "string", enum: [...SCENE_MODES] },
      preset: { type: "string", enum: SCENE_GRADIENTS.map(entry => entry.id) },
      from: { type: "string", description: "#rrggbb" }, to: { type: "string", description: "#rrggbb" },
      original: { type: "boolean", description: "With mode: back to that mode's original gradient." },
      tone: { type: "string", enum: ["light", "dark"] },
      word_font: { type: "string", enum: [...SCENE_WORD_FONTS] },
      reset: { type: "boolean", description: "Everything of Escena back to the default." },
    }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async args => {
      if (bool(args, "reset")) { resetScene(); logAction(translate("lookResetEscena")); return describe(); }
      const palette = str(args, "palette");
      if (palette) setScenePalette(palette);
      if (args.mode !== undefined) {
        const mode = modeArg(args);
        const preset = str(args, "preset"), from = str(args, "from"), to = str(args, "to");
        if (bool(args, "original")) setSceneGradient(mode, null);
        else if (preset) {
          const entry = SCENE_GRADIENTS.find(item => item.id === preset);
          if (!entry) throw new ToolError(`Unknown preset ${preset}. appearance_get lists them.`);
          setSceneGradient(mode, { from: entry.from, to: entry.to });
        } else if (from || to) {
          const current = loadShellLook().scene.gradients[mode] ?? DEFAULT_GRADIENTS[mode];
          const next = { from: (from ?? current.from).toLowerCase(), to: (to ?? current.to).toLowerCase() };
          if (!HEX.test(next.from) || !HEX.test(next.to)) throw new ToolError('"from" and "to" must be colours like #ff8800.');
          setSceneGradient(mode, next);
        } else throw new ToolError("With mode, give preset, from/to or original.");
      }
      const tone = str(args, "tone");
      if (tone) setSceneTone(tone === "dark" ? "dark" : "light");
      const font = str(args, "word_font");
      if (font) {
        if (!(SCENE_WORD_FONTS as readonly string[]).includes(font)) throw new ToolError(`word_font must be one of ${SCENE_WORD_FONTS.join(", ")}.`);
        setSceneWordFont(font as SceneWordFont);
      }
      logAction(translate("lookMenuColors"));
      return describe();
    },
  },
  {
    name: "appearance_set_figure",
    title: "Change a mode's figure",
    description: "Changes one mode's figure in Escena: `scale`, `x_percent`, `y_percent` (limits in appearance_get), a new image as `image_data_url` (data:image/png or webp;base64, 1024×1536, transparent background; it is checked like in the app and refused with the reason if it does not fit), or `original: true` for the original image at its place.",
    inputSchema: { type: "object", properties: {
      mode: { type: "string", enum: [...SCENE_MODES] },
      scale: { type: "number" }, x_percent: { type: "number" }, y_percent: { type: "number" },
      image_data_url: { type: "string", description: "data:image/png;base64,… or data:image/webp;base64,…" },
      original: { type: "boolean" },
    }, required: ["mode"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async args => {
      const mode = modeArg(args);
      if (bool(args, "original")) { setSceneFigure(mode, null); return describe(); }
      const image = str(args, "image_data_url");
      if (image) {
        if (!/^data:image\/(png|webp);base64,/.test(image)) throw new ToolError("image_data_url must be a base64 PNG or WebP data URL.");
        const check = await setSceneFigureImage(mode, await (await fetch(image)).blob());
        if (!check.ok) throw new ToolError(translate(check.reason as TranslationKey));
      }
      const patch: { scale?: number; x?: number; y?: number } = {};
      const scale = num(args, "scale", { min: FIGURE_LIMITS.scale[0], max: FIGURE_LIMITS.scale[1] });
      const x = num(args, "x_percent", { min: FIGURE_LIMITS.x[0], max: FIGURE_LIMITS.x[1] });
      const y = num(args, "y_percent", { min: FIGURE_LIMITS.y[0], max: FIGURE_LIMITS.y[1] });
      if (scale !== undefined) patch.scale = scale;
      if (x !== undefined) patch.x = x;
      if (y !== undefined) patch.y = y;
      if (Object.keys(patch).length) setSceneFigure(mode, patch);
      else if (!image) throw new ToolError("Give scale, x_percent, y_percent, image_data_url or original.");
      logAction(translate("lookMenuFigure"));
      return describe();
    },
  },
  {
    name: "appearance_variations",
    title: "Saved looks of Escena",
    description: "Escena's saved variations (up to 3; each keeps every mode's gradient and figure and the word's font): `save` the current look with a `name`, `apply` one or `delete` one by `id` (from appearance_get).",
    inputSchema: { type: "object", properties: {
      action: { type: "string", enum: ["save", "apply", "delete"] }, name: { type: "string" }, id: { type: "string" },
    }, required: ["action"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async args => {
      const action = str(args, "action"), id = str(args, "id") ?? "";
      const known = () => { if (!loadShellLook().variations.some(entry => entry.id === id)) throw new ToolError(`No variation has id ${id}. appearance_get lists them.`); };
      if (action === "save") {
        if (loadShellLook().variations.length >= MAX_SCENE_VARIATIONS) throw new ToolError(translate("lookVariationsFull"));
        saveSceneVariation(str(args, "name") ?? "");
      } else if (action === "apply") { known(); applySceneVariation(id); }
      else if (action === "delete") { known(); deleteSceneVariation(id); }
      else throw new ToolError('action must be "save", "apply" or "delete".');
      logAction(translate("lookVariations"));
      return describe();
    },
  },
];
