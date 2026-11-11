/**
 * Settings › Appearance for the new shell (vault/Rediseño de navegación.md §5.13): "Style" picks Style 1–4 and changes
 * its values; "Details" sets the mode bar and the sections panel, and the mode bar's word with the old rail's choices
 * (font, size, orientation, spacing, position, GSAP animations). Every change applies at once and is saved
 * (shellLook.ts); each tab can go back to the factory values.
 */
import { RotateCcw } from "lucide-react";
import { GaButton } from "../components/ga/Buttons";
import { Field, Seg, Slider } from "../ModeRailSettings";
import { useI18n, type TranslationKey } from "../i18n";
import {
  DEFAULT_WORD, SHELL_PARAMS, WORD_ANIMATIONS, WORD_FONTS, currentCssValue, saveShellLook, useShellLook,
  type ShellLook, type ShellParamKey, type ShellStyle, type WordPrefs,
} from "./shellLook";

/** A variable's value now, in its unit: a px measure written with clamp() is measured on a probe. */
function resolved(cssVar: string, unit: string): number {
  const raw = currentCssValue(cssVar);
  if (unit === "px" && !/^-?[\d.]+px$/.test(raw)) {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;width:var(${cssVar})`;
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return Math.round(width);
  }
  return parseFloat(raw) || 0;
}

const paramLabel = (key: ShellParamKey) => `look_${key}` as TranslationKey;
const optionLabel = (key: ShellParamKey, option: string) => `look_${key}_${option}` as TranslationKey;

export default function ShellLookSettings({ tab }: { tab: "style" | "details" }) {
  const { t } = useI18n();
  const look = useShellLook();
  const save = (patch: Partial<ShellLook>) => saveShellLook({ ...look, ...patch });
  const setValue = (key: ShellParamKey, value: string | number) => save({ values: { ...look.values, [key]: value } });
  const setWord = <K extends keyof WordPrefs>(key: K, value: WordPrefs[K]) => save({ word: { ...look.word, [key]: value } });
  const params = SHELL_PARAMS.filter(param => param.tab === tab);
  const reset = () => {
    const values = { ...look.values };
    for (const param of params) delete values[param.key];
    save(tab === "style" ? { values } : { values, word: DEFAULT_WORD });
  };

  const controls = params.map(param => param.kind === "choice"
    ? <Field key={param.key} label={t(paramLabel(param.key))} wide>
      <Seg label={t(paramLabel(param.key))} value={String(look.values[param.key] ?? currentCssValue(param.cssVar))}
        onChange={value => setValue(param.key, value)} options={param.options.map(option => [option, t(optionLabel(param.key, option))] as [string, string])} />
    </Field>
    : <Slider key={param.key} id={`ga-look-${param.key}`} label={t(paramLabel(param.key))} min={param.min} max={param.max} step={param.step} unit={param.unit ? ` ${param.unit}` : ""}
      value={Number(look.values[param.key] ?? resolved(param.cssVar, param.unit))} onChange={value => setValue(param.key, value)} />);

  const word = look.word;
  return <div className="ga-rail-settings ga-shell-look">
    {tab === "style" && <fieldset>
      <legend>{t("lookStyle")}</legend>
      <Field label={t("lookStyle")} wide>
        <Seg label={t("lookStyle")} value={String(look.style)} onChange={value => save({ style: Number(value) as ShellStyle })}
          options={([1, 2, 3, 4] as const).map(n => [String(n), t("lookStyleN", { n })] as [string, string])} />
        <p className="ga-style-hint">{t("lookStyleHint")}</p>
      </Field>
    </fieldset>}
    <fieldset>
      <legend>{t(tab === "style" ? "lookStyleValues" : "lookPieces")}</legend>
      {controls}
    </fieldset>
    {tab === "details" && <fieldset>
      <legend>{t("lookWord")}</legend>
      <Field label={t("lookWordFont")}>
        <select aria-label={t("lookWordFont")} value={word.font} onChange={event => setWord("font", event.target.value as WordPrefs["font"])}>
          {WORD_FONTS.map(font => <option key={font} value={font}>{font === "style" ? t("lookFromStyle") : font}</option>)}
        </select>
      </Field>
      <div className="ga-rail-field">
        <Slider id="ga-look-word-size" label={t("lookWordSize")} value={word.size ?? 140} min={40} max={240} step={2} unit=" px" disabled={word.size === null} onChange={value => setWord("size", value)} />
        <label className="ga-style-toggle"><input type="checkbox" checked={word.size === null} onChange={event => setWord("size", event.target.checked ? null : 140)} />{t("lookWordFit")}</label>
      </div>
      <Field label={t("lookWordOrientation")}>
        <Seg label={t("lookWordOrientation")} value={word.orientation} onChange={value => setWord("orientation", value)}
          options={[["up", t("lookWordUp")], ["down", t("lookWordDown")], ["stacked", t("lookWordStacked")]]} />
      </Field>
      <div className="ga-rail-field">
        <Slider id="ga-look-word-tracking" label={t("lookWordTracking")} value={word.tracking ?? 0} min={-.2} max={.5} step={.01} unit=" em" disabled={word.tracking === null} onChange={value => setWord("tracking", value)} />
        <label className="ga-style-toggle"><input type="checkbox" checked={word.tracking === null} onChange={event => setWord("tracking", event.target.checked ? null : 0)} />{t("lookAuto")}</label>
      </div>
      <Field label={t("lookWordAlign")}>
        <Seg label={t("lookWordAlign")} value={word.align} onChange={value => setWord("align", value)}
          options={[["top", t("lookWordTop")], ["center", t("lookWordCenter")], ["bottom", t("lookWordBottom")]]} />
      </Field>
      <Field label={t("lookWordStart")} wide>
        <Seg label={t("lookWordStart")} value={word.start} onChange={value => setWord("start", value)} options={WORD_ANIMATIONS.map(name => [name, t(`lookAnim_${name}` as TranslationKey)] as [typeof name, string])} />
      </Field>
      <Field label={t("lookWordEnd")} wide>
        <Seg label={t("lookWordEnd")} value={word.end} onChange={value => setWord("end", value)} options={WORD_ANIMATIONS.map(name => [name, t(`lookAnim_${name}` as TranslationKey)] as [typeof name, string])} />
      </Field>
      <div className="ga-rail-field">
        <Slider id="ga-look-word-duration" label={t("lookWordDuration")} value={word.duration ?? resolved("--ga-nav-transition-time", "s")} min={.15} max={1.5} step={.05} unit=" s" disabled={word.duration === null} onChange={value => setWord("duration", value)} />
        <label className="ga-style-toggle"><input type="checkbox" checked={word.duration === null} onChange={event => setWord("duration", event.target.checked ? null : .6)} />{t("lookFromStyle")}</label>
      </div>
    </fieldset>}
    <div className="ga-settings-screen-actions"><p>{t("lookSaved")}</p><div>
      <GaButton icon={<RotateCcw size={16} />} onClick={reset}>{t("lookReset")}</GaButton>
    </div></div>
  </div>;
}
