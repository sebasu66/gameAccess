import DigitalStorageSettings from "./DigitalStorageSettings";
import SteamSettings from "./SteamSettings";
import GaTabs from "./GaTabs";
import LanguageSwitch from "./LanguageSwitch";
import StartupSettings from "./StartupSettings";
import { useEffect, useState, useSyncExternalStore } from "react";
import PluginSettings from "./PluginSettings";
import { getPluginStatuses, pollPluginRuntime, subscribePluginStatuses } from "./catalog/PluginRuntime";
import { createPortal } from "react-dom";
import BuildStamp from "./BuildStamp";
import { Settings, RotateCcw, Play } from "lucide-react";
import { useI18n } from "./i18n";
import GaScreen from "./components/ga/Screen";
import { setAppScreen, useAppScreen } from "./appScreen";
import { DEFAULT_PIXEL_STYLE, loadPixelStyle, savePixelStyle, STYLE_RANGES, type StyleParam } from "./pixelStylePreferences";
import { GaButton, GaIconButton } from "./components/ga/Buttons";
const copy = {
 es: { title: "Configuración", tabGames: "Juegos", tabStyle: "Apariencia", style: "Estilo de la aplicación", subtitle: "Juegos, descargas y apariencia", background: "Fondo", field: "Fondo de píxeles animado", fieldHint: "Apagado: fondo gris que toma el color del juego bajo el puntero.", buttons: "Botones principales", animation: "Animación de píxeles y logo", reset: "Restablecer estilo", replay: "Repetir apertura", saved: "Los cambios se guardan automáticamente.", spd: "Velocidad", cob: "Cobalto", blink: "Parpadeo", ovar: "Variación", oled: "Titileo", glass: "Vidrio", close: "Cerrar" },
 en: { title: "Settings", tabGames: "Games", tabStyle: "Appearance", style: "App appearance", subtitle: "Games, downloads and appearance", background: "Background", field: "Animated pixel background", fieldHint: "Off: grey background that takes the colour of the game under the pointer.", buttons: "Main app buttons", animation: "Pixel and logo animation", reset: "Reset appearance", replay: "Replay opening", saved: "Changes are saved automatically.", spd: "Speed", cob: "Cobalt", blink: "Blink", ovar: "Variation", oled: "Twinkle", glass: "Glass", close: "Close" },
};
/** The settings screen (docs/GUI_DESIGN.md §0b): chosen from the frame like the others, no close button. */
function SettingsScreen() {
 const { locale, t } = useI18n(); const c = copy[locale];
 const [style, setStyle] = useState(loadPixelStyle);
 // One tab per connected plugin (its lists, its search, uninstalling it); none when there is no plugin.
 const plugins = useSyncExternalStore(subscribePluginStatuses, getPluginStatuses, getPluginStatuses);
 useEffect(() => { void pollPluginRuntime(); }, []);
 const update = (key: StyleParam, value: number) => { const next = { ...style, [key]: value }; setStyle(next); savePixelStyle(next); };
 const slider = (key: StyleParam) => <label className="ga-style-control" key={key} htmlFor={`ga-style-${key}`}><span>{c[key]}</span><output htmlFor={`ga-style-${key}`}>{style[key]}</output><input id={`ga-style-${key}`} type="range" tabIndex={-1} min={STYLE_RANGES[key][0]} max={STYLE_RANGES[key][1]} step={STYLE_RANGES[key][2]} value={style[key]} onChange={e => update(key, Number(e.target.value))} /></label>;
 return <GaScreen id="ga-settings" mode="settings" title={c.title} subtitle={c.subtitle} className="ga-settings-screen">
  <div className="ga-settings-content ga-settings-screen-content"><GaTabs label={c.title} tabs={[
   { id: "games", label: c.tabGames, content: <DigitalStorageSettings /> },
   { id: "steam", label: t("steamTitle"), content: <SteamSettings /> },
   { id: "style", label: c.tabStyle, content: <>
    <fieldset><legend>{t("language")}</legend><LanguageSwitch /></fieldset>
    <StartupSettings />
    <fieldset><legend>{c.background}</legend><label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={style.field} onChange={e => { const next = { ...style, field: e.target.checked }; setStyle(next); savePixelStyle(next); }} />{c.field}</label>{style.field ? (["spd", "cob", "blink"] as StyleParam[]).map(slider) : <p className="ga-style-hint">{c.fieldHint}</p>}</fieldset>
    <fieldset><legend>{c.buttons}</legend>{(["ovar", "oled", "glass"] as StyleParam[]).map(slider)}</fieldset>
    <label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={style.animate} onChange={e => { const next = { ...style, animate: e.target.checked }; setStyle(next); savePixelStyle(next); }} />{c.animation}</label>
    <div className="ga-settings-screen-actions"><p>{c.saved}</p><div>
     <GaButton icon={<RotateCcw size={16} />} onClick={() => { const next = { ...DEFAULT_PIXEL_STYLE }; setStyle(next); savePixelStyle(next); }}>{c.reset}</GaButton>
     <GaButton icon={<Play size={16} />} onClick={() => { setAppScreen("games"); window.setTimeout(() => window.dispatchEvent(new Event("gameaccess:replay-logo")), 900); }}>{c.replay}</GaButton>
    </div></div>
   </> },
   ...plugins.map(plugin => ({ id: `plugin-${plugin.id}`, label: plugin.name, content: <PluginSettings plugin={plugin} /> })),
  ]} /><BuildStamp /></div>
 </GaScreen>;
}
export default function AppSettings({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
 const { locale } = useI18n(); const c = copy[locale];
 const screen = useAppScreen();
 const button = <GaIconButton className="ga-settings-fab" icon={<Settings size={20} aria-hidden="true" />} label={c.title} pressed={screen === "settings"} onClick={() => setAppScreen("settings")} />;
 return <>
  {dockTarget ? createPortal(button, dockTarget) : button}
  {screen === "settings" ? <SettingsScreen /> : null}</>;
}
