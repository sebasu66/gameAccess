import { useState } from "react";
import { Volume2 } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { loadVoiceSettings, saveVoiceSettings, speak, useVoices, voiceAvailable, type VoiceSettings } from "./aiVoice";
import { useI18n } from "./i18n";
import "./ai-settings.css";

/** Which voice reads the AI's answers and whether it does so on its own. In Settings › AI and at the end of the guide. */
export default function AiVoiceSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState(loadVoiceSettings);
  const voices = useVoices();
  const update = (patch: Partial<VoiceSettings>) => { const next = { ...settings, ...patch }; setSettings(next); saveVoiceSettings(next); };
  if (!voiceAvailable()) return null;
  return <fieldset className="ga-group ga-settings-group">
    <legend className="ga-label">{t("aiVoiceTitle")}</legend>
    <div className="ga-ai-voice-row">
      <select className="ga-settings-select" aria-label={t("aiVoiceWhich")} value={settings.voice} onChange={event => update({ voice: event.target.value })}>
        <option value="">{t("aiVoiceBest")}</option>
        {voices.map(voice => <option key={voice.name} value={voice.name}>{voice.name}</option>)}
      </select>
      <GaButton icon={<Volume2 size={16} aria-hidden="true" />} onClick={() => speak(t("aiVoiceSample"))}>{t("aiVoiceTry")}</GaButton>
    </div>
    <div className="ga-settings-choices" role="group" aria-label={t("aiVoiceWhen")}>
      <button type="button" className="ga-settings-choice" aria-pressed={settings.auto} onClick={() => update({ auto: true })}>{t("aiVoiceAuto")}</button>
      <button type="button" className="ga-settings-choice" aria-pressed={!settings.auto} onClick={() => update({ auto: false })}>{t("aiVoiceButton")}</button>
    </div>
  </fieldset>;
}
