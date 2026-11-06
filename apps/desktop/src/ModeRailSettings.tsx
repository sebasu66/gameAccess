/**
 * Settings > Appearance > mode rail: the same controls as the "GA Mode Rail" prototype, applied to the real rail at
 * once and saved in the user's preferences (modeRailPreferences.ts). The custom CSS is the exception: it is applied
 * with a button, after checking it (railCss.ts) and checking that the rail can still be seen; otherwise nothing changes
 * and the error says why. Stage: prototype.
 */
import { useEffect, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { validateRailCss, type CssProblem } from "./components/ga/modeRail/railCss";
import { railHidden, setRailPreview, useRailPreview, RAIL_LABELS } from "./ModeRail";
import {
  DEFAULT_MODE_RAIL, RAIL_ANIMATIONS, RAIL_BLENDS, RAIL_FONTS, RAIL_MODE_ORDER, saveModeRail, useModeRail,
  type ModeRailPrefs, type RailMode,
} from "./modeRailPreferences";

const copy = {
  es: {
    rail: "Barra de modo", show: "Mostrar la barra de modo", width: "Ancho", seeOn: "Ver en", current: "Modo actual",
    text: "Texto de la barra", font: "Fuente", size: "Tamaño", fit: "Ajustar al alto", orientation: "Orientación", up: "Girada ↑", down: "Girada ↓", stacked: "Letras derechas",
    tracking: "Espacio entre letras", auto: "Automático", position: "Posición", top: "Arriba", center: "Centro", bottom: "Abajo", offset: "Desplazamiento",
    fill: "Relleno", color: "Color", imageFill: "Imagen (máscara)", ink: "Color del texto", inkAuto: "Automático", inkOpacity: "Opacidad del texto",
    stroke: "Borde", strokeWidth: "Ancho del borde", hazard: "Barras de peligro",
    image: "Imagen de la barra", background: "Imagen", none: "Sin imagen", caps: "Tapas incluidas", strips: "Franjas incluidas", custom: "Imagen propia", upload: "Subir imagen…",
    format: "Formato", formatAuto: "Auto", formatStrips: "Franjas", formatCaps: "Tapas (encabezado y pie)", detected: "Detectado", inUse: "en uso", detCaps: "tapas", detStrips: "franjas",
    stripsCount: "Franjas", order: "Orden: Home, Juegos, Manager, Parental, Ajustes.", blend: "Fusión", contrast: "Contraste", brightness: "Brillo", saturate: "Saturación", opacity: "Opacidad",
    behind: "Con texto-imagen, mostrar también la imagen detrás", railColor: "Color de la barra", fromCap: "Según la tapa",
    motion: "Animación de la barra", start: "Al entrar", end: "Al salir", duration: "Duración",
    css: "CSS de la barra", cssHint: "Se aplica solo dentro de la barra. Partes: .rail, .body, .bg, .hazard, .stage, .word, .char, .cap. Variables: --rail, --ink, --hazard.",
    apply: "Aplicar estilo", applied: "Estilo aplicado y guardado.", resetRail: "Restablecer barra",
    cssError: "No se puede aplicar el estilo.", cssHides: "Error: con este estilo la barra deja de verse.",
    reasons: { declaration: "no tiene la forma «propiedad: valor»", empty: "no tiene valor", value: "el valor no es válido para esa propiedad", open: "falta la llave «{»", extra: "sobra una llave «}»", outside: "está fuera de un bloque { }", unclosed: "falta cerrar la llave «}»", selector: "el selector no es válido", "at-rule": "esa regla @ no se admite", nested: "hay un bloque dentro de otro" } as Record<string, string>,
    line: "línea", tooBig: "No se pudo guardar la imagen: es muy grande para las preferencias. Probá con una más chica.", badFile: "El archivo no es una imagen.",
    animations: { slide: "Deslizar", letters: "Letras", wipe: "Barrido", decode: "Decodificar", fade: "Fundido", none: "Ninguna" } as Record<string, string>,
  },
  en: {
    rail: "Mode rail", show: "Show the mode rail", width: "Width", seeOn: "See it on", current: "Current mode",
    text: "Rail text", font: "Font", size: "Size", fit: "Fit to height", orientation: "Orientation", up: "Turned ↑", down: "Turned ↓", stacked: "Upright letters",
    tracking: "Letter spacing", auto: "Automatic", position: "Position", top: "Top", center: "Centre", bottom: "Bottom", offset: "Offset",
    fill: "Fill", color: "Colour", imageFill: "Image (mask)", ink: "Text colour", inkAuto: "Automatic", inkOpacity: "Text opacity",
    stroke: "Outline", strokeWidth: "Outline width", hazard: "Hazard stripes",
    image: "Rail image", background: "Image", none: "No image", caps: "Included caps", strips: "Included strips", custom: "Own image", upload: "Upload image…",
    format: "Format", formatAuto: "Auto", formatStrips: "Strips", formatCaps: "Caps (header and footer)", detected: "Detected", inUse: "in use", detCaps: "caps", detStrips: "strips",
    stripsCount: "Strips", order: "Order: Home, Games, Manager, Parental, Settings.", blend: "Blend", contrast: "Contrast", brightness: "Brightness", saturate: "Saturation", opacity: "Opacity",
    behind: "With image text, also show the image behind", railColor: "Rail colour", fromCap: "From the cap",
    motion: "Rail animation", start: "Coming in", end: "Going out", duration: "Duration",
    css: "Rail CSS", cssHint: "Applies only inside the rail. Parts: .rail, .body, .bg, .hazard, .stage, .word, .char, .cap. Variables: --rail, --ink, --hazard.",
    apply: "Apply style", applied: "Style applied and saved.", resetRail: "Reset rail",
    cssError: "The style cannot be applied.", cssHides: "Error: with this style the rail can no longer be seen.",
    reasons: { declaration: "is not in the form “property: value”", empty: "has no value", value: "the value is not valid for that property", open: "a “{” is missing", extra: "there is an extra “}”", outside: "is outside a { } block", unclosed: "a “}” is missing", selector: "the selector is not valid", "at-rule": "that @ rule is not allowed", nested: "there is a block inside another" } as Record<string, string>,
    line: "line", tooBig: "The image could not be saved: it is too large for the preferences. Try a smaller one.", badFile: "The file is not an image.",
    animations: { slide: "Slide", letters: "Letters", wipe: "Wipe", decode: "Decode", fade: "Fade", none: "None" } as Record<string, string>,
  },
};
type Copy = typeof copy.es;

const frames = (count: number) => new Promise<void>(resolve => { const tick = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 16); const step = (n: number) => n <= 0 ? resolve() : tick(() => step(n - 1)); step(count); });

export function describeCssProblem(problem: CssProblem, c: Copy): string {
  return `${c.cssError}\nError (${c.line} ${problem.line}): «${problem.text}» ${c.reasons[problem.reason] ?? ""}`.trim();
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (value: T) => void; label: string }) {
  return <div className="ga-rail-seg" role="group" aria-label={label}>{options.map(([key, text]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>)}</div>;
}

function Slider({ id, label, value, min, max, step, unit = "", disabled, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; unit?: string; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className="ga-style-control" htmlFor={id}><span>{label}</span><output htmlFor={id}>{disabled ? "auto" : `${Math.round(value * 100) / 100}${unit}`}</output><input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /></label>;
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "ga-rail-field ga-rail-wide" : "ga-rail-field"}><span>{label}</span>{children}</div>;
}

export default function ModeRailSettings() {
  const { locale } = useI18n();
  const c = copy[locale === "en" ? "en" : "es"];
  const prefs = useModeRail();
  const previewing = useRailPreview();
  const [cssDraft, setCssDraft] = useState(prefs.css);
  const [cssError, setCssError] = useState<string | null>(null);
  const [cssApplied, setCssApplied] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [detected, setDetected] = useState<{ format: string; detected: string; cols: number } | null>(null);

  useEffect(() => () => setRailPreview(null), []);
  useEffect(() => {
    const read = (event: Event) => setDetected((event as CustomEvent).detail);
    document.addEventListener("ga-bg-format", read);
    return () => document.removeEventListener("ga-bg-format", read);
  }, []);

  const save = (patch: Partial<ModeRailPrefs>) => { const ok = saveModeRail({ ...prefs, ...patch }); setImageError(ok ? null : c.tooBig); return ok; };
  const set = <K extends keyof ModeRailPrefs>(key: K) => (value: ModeRailPrefs[K]) => save({ [key]: value } as Partial<ModeRailPrefs>);

  const applyCss = async () => {
    setCssApplied(false);
    const problems = validateRailCss(cssDraft);
    if (problems.length) { setCssError(problems.map(problem => describeCssProblem(problem, c)).slice(0, 3).join("\n")); return; }
    const rail = document.querySelector<HTMLElement & { settled?: () => Promise<void> }>("ga-mode-rail");
    if (rail && prefs.enabled) {
      const before = rail.getAttribute("css");
      if (cssDraft) rail.setAttribute("css", cssDraft); else rail.removeAttribute("css");
      await rail.settled?.();
      await frames(2);
      if (railHidden(rail)) {
        if (before) rail.setAttribute("css", before); else rail.removeAttribute("css");
        setCssError(`${c.cssError}\n${c.cssHides}`);
        return;
      }
    }
    save({ css: cssDraft });
    setCssError(null);
    setCssApplied(true);
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setImageError(c.badFile); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") save({ background: "custom", backgroundData: reader.result }); };
    reader.readAsDataURL(file);
  };

  const hasImage = prefs.background !== "none";
  const labels = RAIL_LABELS[locale === "en" ? "en" : "es"];
  const detectedText = detected && detected.format
    ? `${c.detected}: ${detected.detected === "caps" ? `${c.detCaps} (2 × ${detected.cols})` : c.detStrips} · ${c.inUse}: ${detected.format === "caps" ? c.detCaps : c.detStrips}`
    : "";

  return <div className="ga-rail-settings">
    <fieldset>
      <legend>{c.rail}</legend>
      <label className="ga-style-toggle"><input type="checkbox" checked={prefs.enabled} onChange={e => save({ enabled: e.target.checked })} />{c.show}</label>
      <Slider id="ga-rail-width" label={c.width} value={prefs.width} min={72} max={180} step={2} unit=" px" onChange={set("width")} />
      <Field label={c.seeOn} wide>
        <Seg label={c.seeOn} value={previewing ?? "current"} onChange={mode => setRailPreview(mode === "current" ? null : mode as RailMode)}
          options={[["current", c.current], ...RAIL_MODE_ORDER.map(mode => [mode, labels[mode]] as [string, string])]} />
      </Field>
    </fieldset>

    <fieldset>
      <legend>{c.text}</legend>
      <Field label={c.font}><select aria-label={c.font} value={prefs.font} onChange={e => save({ font: e.target.value })}>{RAIL_FONTS.map(font => <option key={font} value={font}>{font}</option>)}</select></Field>
      <div className="ga-rail-field">
        <Slider id="ga-rail-size" label={c.size} value={prefs.size ?? 180} min={40} max={320} step={2} unit=" px" disabled={prefs.size === null} onChange={set("size")} />
        <label className="ga-style-toggle"><input type="checkbox" checked={prefs.size === null} onChange={e => save({ size: e.target.checked ? null : 180 })} />{c.fit}</label>
      </div>
      <Field label={c.orientation}><Seg label={c.orientation} value={prefs.orientation} onChange={set("orientation")} options={[["up", c.up], ["down", c.down], ["stacked", c.stacked]]} /></Field>
      <div className="ga-rail-field">
        <Slider id="ga-rail-tracking" label={c.tracking} value={prefs.tracking ?? 0} min={-.4} max={.4} step={.01} unit=" em" disabled={prefs.tracking === null} onChange={set("tracking")} />
        <label className="ga-style-toggle"><input type="checkbox" checked={prefs.tracking === null} onChange={e => save({ tracking: e.target.checked ? null : 0 })} />{c.auto}</label>
      </div>
      <Field label={c.position}><Seg label={c.position} value={prefs.align} onChange={set("align")} options={[["top", c.top], ["center", c.center], ["bottom", c.bottom]]} /></Field>
      <Slider id="ga-rail-offset" label={c.offset} value={prefs.offset} min={-400} max={400} step={2} unit=" px" onChange={set("offset")} />
      <Field label={c.fill}><Seg label={c.fill} value={prefs.fill} onChange={set("fill")} options={[["color", c.color], ["image", c.imageFill]]} /></Field>
      <Field label={c.ink}>
        <div className="ga-rail-color">
          <input type="color" aria-label={c.ink} value={prefs.ink ?? "#0a0705"} disabled={prefs.ink === null} onChange={e => save({ ink: e.target.value })} />
          <label className="ga-style-toggle"><input type="checkbox" checked={prefs.ink === null} onChange={e => save({ ink: e.target.checked ? null : "#0a0705" })} />{c.inkAuto}</label>
        </div>
      </Field>
      <Slider id="ga-rail-ink-opacity" label={c.inkOpacity} value={prefs.inkOpacity} min={0} max={1} step={.05} onChange={set("inkOpacity")} />
      <Field label={c.stroke}><div className="ga-rail-color"><input type="color" aria-label={c.stroke} value={prefs.stroke} onChange={e => save({ stroke: e.target.value })} /></div></Field>
      <Slider id="ga-rail-stroke" label={c.strokeWidth} value={prefs.strokeWidth} min={0} max={8} step={.5} unit=" px" onChange={set("strokeWidth")} />
      <label className="ga-style-toggle"><input type="checkbox" checked={prefs.hazard} onChange={e => save({ hazard: e.target.checked })} />{c.hazard}</label>
    </fieldset>

    <fieldset>
      <legend>{c.image}</legend>
      <Field label={c.background} wide>
        <Seg label={c.background} value={prefs.background} onChange={background => background === "custom" ? document.getElementById("ga-rail-upload")?.click() : save({ background })}
          options={[["none", c.none], ["caps", c.caps], ["strips", c.strips], ["custom", prefs.backgroundData ? c.custom : c.upload]]} />
        <input id="ga-rail-upload" type="file" accept="image/*" hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        {imageError ? <p className="ga-rail-error" role="alert">{imageError}</p> : null}
      </Field>
      {hasImage ? <>
        <Field label={c.format} wide>
          <Seg label={c.format} value={prefs.format} onChange={set("format")} options={[["auto", c.formatAuto], ["strips", c.formatStrips], ["caps", c.formatCaps]]} />
          <span className="ga-rail-status" aria-live="polite">{detectedText}</span>
        </Field>
        <div className="ga-rail-field"><Slider id="ga-rail-strips" label={c.stripsCount} value={prefs.strips} min={1} max={8} step={1} onChange={set("strips")} /><span className="ga-rail-status">{c.order}</span></div>
        <Field label={c.blend}><select aria-label={c.blend} value={prefs.blend} onChange={e => save({ blend: e.target.value })}>{RAIL_BLENDS.map(blend => <option key={blend} value={blend}>{blend}</option>)}</select></Field>
        <Slider id="ga-rail-contrast" label={c.contrast} value={prefs.contrast} min={0} max={2} step={.05} onChange={set("contrast")} />
        <Slider id="ga-rail-brightness" label={c.brightness} value={prefs.brightness} min={0} max={2} step={.05} onChange={set("brightness")} />
        <Slider id="ga-rail-saturate" label={c.saturate} value={prefs.saturate} min={0} max={2} step={.05} onChange={set("saturate")} />
        <Slider id="ga-rail-opacity" label={c.opacity} value={prefs.opacity} min={0} max={1} step={.05} onChange={set("opacity")} />
        <Field label={c.railColor}>
          <div className="ga-rail-color">
            <input type="color" aria-label={c.railColor} value={prefs.railColor ?? "#e8661c"} disabled={prefs.railColor === null} onChange={e => save({ railColor: e.target.value })} />
            <label className="ga-style-toggle"><input type="checkbox" checked={prefs.railColor === null} onChange={e => save({ railColor: e.target.checked ? null : "#e8661c" })} />{c.fromCap}</label>
          </div>
        </Field>
        <label className="ga-style-toggle"><input type="checkbox" checked={prefs.behind} onChange={e => save({ behind: e.target.checked })} />{c.behind}</label>
      </> : null}
    </fieldset>

    <fieldset>
      <legend>{c.motion}</legend>
      <Field label={c.start}><select aria-label={c.start} value={prefs.start} onChange={e => save({ start: e.target.value as ModeRailPrefs["start"] })}>{RAIL_ANIMATIONS.map(name => <option key={name} value={name}>{c.animations[name]}</option>)}</select></Field>
      <Field label={c.end}><select aria-label={c.end} value={prefs.end} onChange={e => save({ end: e.target.value as ModeRailPrefs["end"] })}>{RAIL_ANIMATIONS.map(name => <option key={name} value={name}>{c.animations[name]}</option>)}</select></Field>
      <Slider id="ga-rail-duration" label={c.duration} value={prefs.duration} min={.15} max={1.5} step={.05} unit=" s" onChange={set("duration")} />
    </fieldset>

    <fieldset className="ga-rail-css">
      <legend>{c.css}</legend>
      <div className="ga-rail-wide">
        <textarea id="ga-rail-css" aria-label={c.css} spellCheck={false} value={cssDraft} onChange={e => { setCssDraft(e.target.value); setCssApplied(false); }} placeholder={".word { letter-spacing: .04em; }\n.rail { --rail: #6fcfb0; }"} />
        <p className="ga-rail-status">{c.cssHint}</p>
        {cssError ? <p className="ga-rail-error" role="alert">{cssError}</p> : null}
        {cssApplied ? <p className="ga-rail-ok" role="status">{c.applied}</p> : null}
        <div className="ga-rail-css-actions">
          <GaButton variant="primary" onClick={() => { void applyCss(); }}>{c.apply}</GaButton>
          <GaButton icon={<RotateCcw size={16} />} onClick={() => { saveModeRail({ ...DEFAULT_MODE_RAIL }); setCssDraft(""); setCssError(null); setCssApplied(false); setImageError(null); }}>{c.resetRail}</GaButton>
        </div>
      </div>
    </fieldset>
  </div>;
}
