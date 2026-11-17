import { useState } from "react";
import { useI18n } from "./i18n";
import { loadStartup, saveStartup, type StartScreen, type StartupPreferences } from "./startupPreferences";

const SCREENS: Array<{ id: StartScreen; label: "startScreenHome" | "startScreenCatalog" | "startScreenLibrary" }> = [
  { id: "home", label: "startScreenHome" }, { id: "catalog", label: "startScreenCatalog" }, { id: "library", label: "startScreenLibrary" },
];

/** Settings → Appearance: where the app opens and whether the opening plays its sound (startupPreferences.ts). */
export default function StartupSettings() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState(loadStartup);
  const update = (patch: Partial<StartupPreferences>) => { const next = { ...prefs, ...patch }; setPrefs(next); saveStartup(next); };
  return <fieldset>
    <legend>{t("startupTitle")}</legend>
    <div className="ga-settings-language" role="radiogroup" aria-label={t("startScreenLabel")}>
      {SCREENS.map(screen => <button key={screen.id} type="button" role="radio" aria-checked={prefs.startScreen === screen.id} onClick={() => update({ startScreen: screen.id })}>{t(screen.label)}</button>)}
    </div>
    <label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={prefs.muteOpening} onChange={event => update({ muteOpening: event.target.checked })} />{t("startupMuteOpening")}</label>
  </fieldset>;
}
