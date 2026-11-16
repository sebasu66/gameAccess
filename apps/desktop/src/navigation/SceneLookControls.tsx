/**
 * The controls of Escena's look (sceneLook.ts), shared by the right-click menus on the scene (SceneLookMenu) and by
 * Settings › Appearance (ShellLookSettings): a whole palette, one mode's gradient (a chosen one or two colours of the
 * player's own), a mode's figure (their image, scale and position), the big word's font and the saved variations.
 * General pieces first (GaButton, ga-label, ga-hint, the settings fields); scene-look.css only lays them out.
 */
import { useRef, useState, type CSSProperties } from "react";
import { ImageUp, RotateCcw, Save, Trash2 } from "lucide-react";
import { GaButton } from "../components/ga/Buttons";
import { Field, Seg, Slider } from "../ModeRailSettings";
import { useI18n, type TranslationKey } from "../i18n";
import { NAVIGATION } from "./navigationTree";
import { useShellLook } from "./shellLook";
import {
  DEFAULT_FIGURE, DEFAULT_GRADIENTS, FIGURE_LIMITS, MAX_SCENE_VARIATIONS, SCENE_GRADIENTS, SCENE_MODES, SCENE_PALETTES, SCENE_WORD_FONTS,
  useFigureSrc, type SceneGradient, type SceneMode, type SceneWordFont,
} from "./sceneLook";
import {
  applySceneVariation, deleteSceneVariation, saveSceneVariation, setSceneFigure, setSceneFigureImage, setSceneGradient,
  setScenePalette, setSceneWordFont,
} from "./sceneLookActions";
import "./scene-look.css";

export const modeLabel = (mode: SceneMode) => NAVIGATION.find(item => item.id === mode)!.label;
const swatch = (gradient: SceneGradient) => ({ "--ga-scene-swatch-from": gradient.from, "--ga-scene-swatch-to": gradient.to }) as CSSProperties;
const same = (a: SceneGradient | undefined, b: SceneGradient) => Boolean(a) && a!.from === b.from && a!.to === b.to;

/** Which mode a control edits: the four as a row of choices. */
export function ModeChoice({ value, onChange }: { value: SceneMode; onChange: (mode: SceneMode) => void }) {
  const { t } = useI18n();
  return <Seg label={t("lookMode")} value={value} onChange={onChange} options={SCENE_MODES.map(mode => [mode, t(modeLabel(mode))] as [SceneMode, string])} />;
}

/** One gradient for all four modes at once. */
export function PaletteControl() {
  const { t } = useI18n();
  const look = useShellLook();
  const active = Object.entries(SCENE_PALETTES).find(([id, palette]) => id === "original"
    ? !Object.keys(look.scene.gradients).length
    : SCENE_MODES.every(mode => same(look.scene.gradients[mode], SCENE_GRADIENTS.find(entry => entry.id === palette[mode])!)))?.[0] ?? "";
  return <Field label={t("lookPalette")} wide>
    <Seg label={t("lookPalette")} value={active} onChange={setScenePalette} options={Object.keys(SCENE_PALETTES).map(id => [id, t(`lookPalette_${id}` as TranslationKey)] as [string, string])} />
  </Field>;
}

/** A mode's gradient: the chosen ones, two colours of the player's own, or back to the original. */
export function GradientControl({ mode }: { mode: SceneMode }) {
  const { t } = useI18n();
  const look = useShellLook();
  const own = look.scene.gradients[mode];
  const shown = own ?? DEFAULT_GRADIENTS[mode];
  const set = (patch: Partial<SceneGradient>) => setSceneGradient(mode, { ...shown, ...patch });
  return <div className="ga-scene-look-gradient">
    <span className="ga-label">{t("lookGradient", { mode: t(modeLabel(mode)) })}</span>
    <div className="ga-scene-look-swatches" role="group" aria-label={t("lookGradientPresets")}>
      {SCENE_GRADIENTS.map(preset => <button key={preset.id} type="button" className="ga-scene-look-swatch" style={swatch(preset)}
        aria-pressed={own ? same(own, preset) : same(DEFAULT_GRADIENTS[mode], preset)} title={t(`lookGradient_${preset.id}` as TranslationKey)} aria-label={t(`lookGradient_${preset.id}` as TranslationKey)}
        onClick={() => setSceneGradient(mode, { from: preset.from, to: preset.to })} />)}
    </div>
    <div className="ga-scene-look-colors">
      <span className="ga-scene-look-preview" style={swatch(shown)} aria-hidden="true" />
      <label className="ga-scene-look-color"><span className="ga-hint">{t("lookGradientFrom")}</span><input type="color" value={shown.from} onChange={event => set({ from: event.target.value })} /></label>
      <label className="ga-scene-look-color"><span className="ga-hint">{t("lookGradientTo")}</span><input type="color" value={shown.to} onChange={event => set({ to: event.target.value })} /></label>
      <GaButton icon={<RotateCcw size={16} />} disabled={!own} onClick={() => setSceneGradient(mode, null)}>{t("lookOriginal")}</GaButton>
    </div>
  </div>;
}

/** A mode's figure: the player's own image (checked first), its scale and position, or back to the original. */
export function FigureControl({ mode }: { mode: SceneMode }) {
  const { t } = useI18n();
  const look = useShellLook();
  const figure = look.scene.figures[mode];
  const current = figure ?? DEFAULT_FIGURE;
  const src = useFigureSrc(mode, figure?.image);
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const check = await setSceneFigureImage(mode, file);
    if (!check.ok) setStatus({ text: t(check.reason), error: true });
    else setStatus({ text: check.exact ? t("lookFigureDone") : t("lookFigureResized", { width: check.width, height: check.height }), error: false });
  };
  return <div className="ga-scene-look-figure">
    <span className="ga-label">{t("lookFigure", { mode: t(modeLabel(mode)) })}</span>
    <div className="ga-scene-look-figure-row">
      <img className="ga-scene-look-thumb" src={src} alt="" />
      <div className="ga-scene-look-figure-body">
        <div className="ga-scene-look-actions">
          <GaButton icon={<ImageUp size={16} />} onClick={() => input.current?.click()}>{t("lookFigureChange")}</GaButton>
          <GaButton icon={<RotateCcw size={16} />} disabled={!figure} onClick={() => { setSceneFigure(mode, null); setStatus(null); }}>{t("lookOriginal")}</GaButton>
        </div>
        <input ref={input} type="file" accept="image/png,image/webp" hidden onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }} />
        <p className="ga-hint">{t("lookFigureHint")}</p>
        {status && <p className={status.error ? "ga-status is-error" : "ga-status is-ok"} role="status">{status.text}</p>}
      </div>
    </div>
    <Slider id={`ga-look-${mode}-scale`} label={t("lookFigureScale")} value={current.scale} min={FIGURE_LIMITS.scale[0]} max={FIGURE_LIMITS.scale[1]} step={FIGURE_LIMITS.scale[2]} unit="×" onChange={scale => setSceneFigure(mode, { scale })} />
    <Slider id={`ga-look-${mode}-x`} label={t("lookFigureX")} value={current.x} min={FIGURE_LIMITS.x[0]} max={FIGURE_LIMITS.x[1]} step={FIGURE_LIMITS.x[2]} unit=" %" onChange={x => setSceneFigure(mode, { x })} />
    <Slider id={`ga-look-${mode}-y`} label={t("lookFigureY")} value={current.y} min={FIGURE_LIMITS.y[0]} max={FIGURE_LIMITS.y[1]} step={FIGURE_LIMITS.y[2]} unit=" %" onChange={y => setSceneFigure(mode, { y })} />
  </div>;
}

export function WordFontControl() {
  const { t } = useI18n();
  const look = useShellLook();
  return <Field label={t("lookWordFontEscena")} wide>
    <select aria-label={t("lookWordFontEscena")} value={look.scene.wordFont} onChange={event => setSceneWordFont(event.target.value as SceneWordFont)}>
      {SCENE_WORD_FONTS.map(font => <option key={font} value={font}>{font === "Anton" ? t("lookWordFontOriginal") : font}</option>)}
    </select>
  </Field>;
}

/** Up to three saved variations: each keeps every mode's gradient and figure, and the word's font. */
export function VariationsControl() {
  const { t } = useI18n();
  const look = useShellLook();
  const [name, setName] = useState("");
  const full = look.variations.length >= MAX_SCENE_VARIATIONS;
  return <div className="ga-scene-look-variations">
    <p className="ga-hint">{t("lookVariationsHint", { n: MAX_SCENE_VARIATIONS })}</p>
    {look.variations.length ? <ul className="ga-scene-look-variation-list">{look.variations.map(variation => <li key={variation.id}>
      <span className="ga-scene-look-variation-swatches" aria-hidden="true">{SCENE_MODES.map(mode => <i key={mode} style={swatch(variation.scene.gradients[mode] ?? DEFAULT_GRADIENTS[mode])} />)}</span>
      <strong>{variation.name}</strong>
      <GaButton onClick={() => applySceneVariation(variation.id)}>{t("lookVariationApply")}</GaButton>
      <GaButton variant="danger" icon={<Trash2 size={16} />} onClick={() => deleteSceneVariation(variation.id)}>{t("lookVariationDelete")}</GaButton>
    </li>)}</ul> : <p className="ga-hint">{t("lookVariationsEmpty")}</p>}
    {full ? <p className="ga-hint">{t("lookVariationsFull")}</p> : <div className="ga-scene-look-save">
      <Field label={t("lookVariationName")}><input type="text" maxLength={40} value={name} placeholder={t("lookVariationPlaceholder", { n: look.variations.length + 1 })} onChange={event => setName(event.target.value)} /></Field>
      <GaButton icon={<Save size={16} />} onClick={() => { saveSceneVariation(name); setName(""); }}>{t("lookVariationSave")}</GaButton>
    </div>}
  </div>;
}
