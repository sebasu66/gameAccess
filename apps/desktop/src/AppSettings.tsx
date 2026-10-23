import DigitalStorageSettings from "./DigitalStorageSettings";
import ParentalControlSection from "./ParentalControlSection";
import GaTabs from "./GaTabs";
import LanguageSwitch from "./LanguageSwitch";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BuildStamp from "./BuildStamp";
import { Button } from "./components/ui/button";
import { Settings, RotateCcw, Play } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { DEFAULT_PIXEL_STYLE, loadPixelStyle, savePixelStyle, STYLE_RANGES, type StyleParam } from "./pixelStylePreferences";
import { GaClose, GaIconButton } from "./components/ga/Buttons";
const copy = {
 es: { title: "Configuración", tabGames: "Juegos", tabParental: "Control parental", tabStyle: "Apariencia", style: "Estilo de la aplicación", subtitle: "Juegos, descargas y apariencia", background: "Fondo", field: "Fondo de píxeles animado", fieldHint: "Apagado: fondo gris que toma el color del juego bajo el puntero.", buttons: "Botones principales", animation: "Animación de píxeles y logo", reset: "Restablecer estilo", replay: "Repetir apertura", saved: "Los cambios se guardan automáticamente.", spd: "Velocidad", cob: "Cobalto", blink: "Parpadeo", ovar: "Variación", oled: "Titileo", glass: "Vidrio", close: "Cerrar" },
 en: { title: "Settings", tabGames: "Games", tabParental: "Parental control", tabStyle: "Appearance", style: "App appearance", subtitle: "Games, downloads and appearance", background: "Background", field: "Animated pixel background", fieldHint: "Off: grey background that takes the colour of the game under the pointer.", buttons: "Main app buttons", animation: "Pixel and logo animation", reset: "Reset appearance", replay: "Replay opening", saved: "Changes are saved automatically.", spd: "Speed", cob: "Cobalt", blink: "Blink", ovar: "Variation", oled: "Twinkle", glass: "Glass", close: "Close" },
};
function SettingsPanel({ onClose }: { onClose: () => void }) {
 const { locale, t } = useI18n(); const c = copy[locale];
 const panel = useDialogFocus(onClose);
 const [style, setStyle] = useState(loadPixelStyle);
 const update = (key: StyleParam, value: number) => { const next = { ...style, [key]: value }; setStyle(next); savePixelStyle(next); };
 const slider = (key: StyleParam) => <label className="ga-style-control" key={key} htmlFor={`ga-style-${key}`}><span>{c[key]}</span><output htmlFor={`ga-style-${key}`}>{style[key]}</output><input id={`ga-style-${key}`} type="range" tabIndex={-1} min={STYLE_RANGES[key][0]} max={STYLE_RANGES[key][1]} step={STYLE_RANGES[key][2]} value={style[key]} onChange={e => update(key, Number(e.target.value))} /></label>;
 return <div className="ga-settings-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
  <section ref={panel} className="ga-settings-panel" role="dialog" aria-modal="true" aria-labelledby="ga-settings-title">
   <header><div><span className="eyebrow">GAME ACCESS</span><h2 id="ga-settings-title">{c.title}</h2><p>{c.subtitle}</p></div><GaClose label={c.close} onClick={onClose} data-dialog-initial /></header>
   <div className="ga-settings-content"><GaTabs label={c.title} tabs={[
    { id: "games", label: c.tabGames, content: <DigitalStorageSettings /> },
    { id: "parental", label: c.tabParental, content: <ParentalControlSection /> },
    { id: "style", label: c.tabStyle, content: <>
      <fieldset><legend>{t("language")}</legend><LanguageSwitch /></fieldset>
      <fieldset><legend>{c.background}</legend><label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={style.field} onChange={e => { const next = { ...style, field: e.target.checked }; setStyle(next); savePixelStyle(next); }} />{c.field}</label>{style.field ? (["spd", "cob", "blink"] as StyleParam[]).map(slider) : <p className="ga-style-hint">{c.fieldHint}</p>}</fieldset>
      <fieldset><legend>{c.buttons}</legend>{(["ovar", "oled", "glass"] as StyleParam[]).map(slider)}</fieldset>
      <label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={style.animate} onChange={e => { const next = { ...style, animate: e.target.checked }; setStyle(next); savePixelStyle(next); }} />{c.animation}</label>
    </> },
   ]} /><BuildStamp />
   </div>
   <footer><p>{c.saved}</p><div><Button onClick={() => { const next = { ...DEFAULT_PIXEL_STYLE }; setStyle(next); savePixelStyle(next); }}><RotateCcw size={16} />{c.reset}</Button><Button onClick={() => { onClose(); window.dispatchEvent(new Event("gameaccess:replay-logo")); }}><Play size={16} />{c.replay}</Button></div></footer>
  </section>
 </div>;
}
export default function AppSettings({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
 const { locale } = useI18n(); const c = copy[locale];
 const [open, setOpen] = useState(false);
 const trigger = useRef<HTMLButtonElement>(null);
 const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
 const button = <GaIconButton ref={trigger} className="ga-settings-fab" icon={<Settings size={20} aria-hidden="true" />} label={c.title} onClick={() => setOpen(true)} />;
 return <>
  {dockTarget ? createPortal(button, dockTarget) : button}
  {open ? <SettingsPanel onClose={close} /> : null}</>;
}
