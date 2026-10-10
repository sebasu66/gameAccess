import DigitalStorageSettings from "./DigitalStorageSettings";
import { useCallback, useRef, useState } from "react";
import BuildStamp from "./BuildStamp";
import { Settings, X, RotateCcw, Play } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { DEFAULT_PIXEL_STYLE, loadPixelStyle, savePixelStyle, STYLE_RANGES, type StyleParam } from "./pixelStylePreferences";
const copy = {
 es: { title: "Configuración", style: "Estilo de la aplicación", subtitle: "Juegos, descargas y apariencia", background: "Fondo", buttons: "Botones principales", animation: "Animación de píxeles y logo", reset: "Restablecer estilo", replay: "Repetir apertura", saved: "Los cambios se guardan automáticamente.", spd: "Velocidad", cob: "Cobalto", blink: "Parpadeo", ovar: "Variación", oled: "Titileo", glass: "Vidrio", close: "Cerrar" },
 en: { title: "Settings", style: "App appearance", subtitle: "Games, downloads and appearance", background: "Background", buttons: "Main app buttons", animation: "Pixel and logo animation", reset: "Reset appearance", replay: "Replay opening", saved: "Changes are saved automatically.", spd: "Speed", cob: "Cobalt", blink: "Blink", ovar: "Variation", oled: "Twinkle", glass: "Glass", close: "Close" },
};
function SettingsPanel({ onClose }: { onClose: () => void }) {
 const { locale } = useI18n(); const c = copy[locale];
 const panel = useDialogFocus(onClose);
 const [style, setStyle] = useState(loadPixelStyle);
 const update = (key: StyleParam, value: number) => { const next = { ...style, [key]: value }; setStyle(next); savePixelStyle(next); };
 const slider = (key: StyleParam) => <label className="ga-style-control" key={key} htmlFor={`ga-style-${key}`}><span>{c[key]}</span><output htmlFor={`ga-style-${key}`}>{style[key]}</output><input id={`ga-style-${key}`} type="range" min={STYLE_RANGES[key][0]} max={STYLE_RANGES[key][1]} step={STYLE_RANGES[key][2]} value={style[key]} onChange={e => update(key, Number(e.target.value))} /></label>;
 return <div className="ga-settings-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
  <section ref={panel} className="ga-settings-panel" role="dialog" aria-modal="true" aria-labelledby="ga-settings-title">
   <header><div><span className="eyebrow">GAME ACCESS</span><h2 id="ga-settings-title">{c.title}</h2><p>{c.subtitle}</p></div><button type="button" onClick={onClose} aria-label={c.close} data-dialog-initial><X size={20} /></button></header>
   <div className="ga-settings-content"><DigitalStorageSettings /><details className="ga-settings-group"><summary>{c.style}</summary>
    <fieldset><legend>{c.background}</legend>{(["spd", "cob", "blink"] as StyleParam[]).map(slider)}</fieldset>
    <fieldset><legend>{c.buttons}</legend>{(["ovar", "oled", "glass"] as StyleParam[]).map(slider)}</fieldset>
    <label className="ga-style-toggle"><input type="checkbox" checked={style.animate} onChange={e => { const next = { ...style, animate: e.target.checked }; setStyle(next); savePixelStyle(next); }} />{c.animation}</label>
    </details><BuildStamp />
   </div>
   <footer><p>{c.saved}</p><div><button type="button" onClick={() => { const next = { ...DEFAULT_PIXEL_STYLE }; setStyle(next); savePixelStyle(next); }}><RotateCcw size={16} />{c.reset}</button><button type="button" onClick={() => { onClose(); window.dispatchEvent(new Event("gameaccess:replay-logo")); }}><Play size={16} />{c.replay}</button></div></footer>
  </section>
 </div>;
}
export default function AppSettings() {
 const { locale } = useI18n(); const c = copy[locale];
 const [open, setOpen] = useState(false);
 const trigger = useRef<HTMLButtonElement>(null);
 const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
 return <>
  <button ref={trigger} type="button" className="ga-settings-fab" aria-label={c.title} onClick={() => setOpen(true)}><Settings size={20} /></button>
  {open ? <SettingsPanel onClose={close} /> : null}</>;
}
