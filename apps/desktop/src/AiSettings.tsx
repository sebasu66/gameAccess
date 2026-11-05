import { useCallback, useEffect, useState } from "react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import AiConnectWizard from "./AiConnectWizard";
import AiProfileEditor from "./AiProfileEditor";
import AiVoiceSettings from "./AiVoiceSettings";
import { aiDisconnect, aiState, aiTest, aiTestError, type AiState } from "./aiConnection";
import "./ai-settings.css";

/** Settings › AI: whether a free Ollama key is connected, "Connect" (the wizard), "Try it", "Disconnect" and the profile. */
export default function AiSettings() {
  const { t } = useI18n();
  const [state, setState] = useState<AiState | null>(null);
  const [wizard, setWizard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const refresh = useCallback(() => aiState().then(setState).catch(() => setState({ connected: false, ending: "" })), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const tryIt = async () => {
    setBusy(true); setStatus(null);
    try { await aiTest(); setStatus({ tone: "ok", text: t("aiTestOk") }); }
    catch (error) { const kind = aiTestError(error); setStatus({ tone: kind === "limit" ? "warn" : "error", text: t(`aiError_${kind}`) }); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setStatus(null);
    try { await aiDisconnect(); await refresh(); } finally { setBusy(false); }
  };

  return <section className="ga-ai-settings">
    <p className="ga-hint">{t("aiSettingsHint")}</p>
    {state ? <div className="ga-settings-group ga-ai-settings-card">
      <div className="ga-ai-settings-text">
        <span className="ga-label">{t("aiSettingsTitle")}</span>
        <p role="status" className={`ga-status ${state.connected ? "is-ok" : "is-warn"}`}>{state.connected ? t("aiSettingsOn", { ending: state.ending }) : t("aiSettingsOff")}</p>
      </div>
      <div className="ga-ai-settings-actions">
        {state.connected ? <>
          <GaButton disabled={busy} onClick={() => void tryIt()}>{t("aiTryIt")}</GaButton>
          <GaButton disabled={busy} onClick={() => void disconnect()}>{t("aiDisconnect")}</GaButton>
        </> : <GaButton variant="primary" onClick={() => setWizard(true)}>{t("aiConnect")}</GaButton>}
      </div>
    </div> : null}
    {status ? <p role="status" className={`ga-status is-${status.tone}`}>{status.text}</p> : null}
    <AiVoiceSettings />
    <AiProfileEditor />
    {wizard ? <AiConnectWizard onDone={() => { setWizard(false); void refresh(); }} /> : null}
  </section>;
}
