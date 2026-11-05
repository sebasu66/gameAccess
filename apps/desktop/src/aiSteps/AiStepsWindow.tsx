import { useState, type ClipboardEvent, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { GaButton } from "../components/ga/Buttons";
import { aiOpenKeysInBrowser, aiSaveKey, looksLikeKey } from "../aiConnection";
import { useI18n } from "../i18n";

// What Ollama's own pages say: the drawings show it as it is there, in every language.
const OLLAMA = { google: "Google", github: "GitHub", address: "ollama.com/settings/keys", keys: "API keys", create: "Create API key", name: "GameAccess", confirm: "Create" };

/**
 * The small window that stays on top while the player is in their browser (ai_connection.rs, docs/GUI_DESIGN.md §4.29):
 * the steps with a drawing of each Ollama screen, and the field for the key. A pasted key that looks right is sent at
 * once; Rust keeps it, tells the main window and closes this one.
 */
export default function AiStepsWindow() {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (text: string) => {
    if (!looksLikeKey(text)) { setBad(true); return; }
    setBad(false); setBusy(true);
    try { await aiSaveKey(text.trim()); } catch { setBad(true); } finally { setBusy(false); }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text").trim();
    setKey(text); void send(text);
  };

  return <main className="ga-steps">
    <h1 className="ga-steps-title">{t("aiStepsTitle")}</h1>
    <ol className="ga-steps-list">
      <Step number={1} title={t("aiStep1")}>
        <div className="ga-art ga-art-login"><span className="ga-art-line" /><b>{OLLAMA.google}</b><b>{OLLAMA.github}</b></div>
      </Step>
      <Step number={2} title={t("aiStep2")}>
        <div className="ga-art">
          <span className="ga-art-address">{OLLAMA.address}</span>
          <div className="ga-art-row"><span>{OLLAMA.keys}</span><b>{OLLAMA.create}</b></div>
        </div>
      </Step>
      <Step number={3} title={t("aiStep3")}>
        <div className="ga-art ga-art-row"><span className="ga-art-field">{OLLAMA.name}</span><b>{OLLAMA.confirm}</b></div>
      </Step>
      <Step number={4} title={t("aiStep4")}>
        <input className="ga-steps-key" aria-label={t("aiPasteLabel")} placeholder={t("aiStepsPaste")} value={key} disabled={busy} autoComplete="off" spellCheck={false}
          onPaste={onPaste} onChange={event => { setKey(event.target.value); setBad(false); }}
          onKeyDown={event => { if (event.key === "Enter") void send(key); }} />
        {bad ? <p role="alert" className="ga-status is-error">{t("aiBadKey")}</p> : null}
      </Step>
    </ol>
    <GaButton className="ga-steps-reopen" icon={<ExternalLink size={18} aria-hidden="true" />} onClick={() => void aiOpenKeysInBrowser()}>{t("aiStepsReopen")}</GaButton>
  </main>;
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <li className="ga-step">
    <h2 className="ga-step-title"><span className="ga-step-number" aria-hidden="true">{number}</span>{title}</h2>
    {children}
  </li>;
}
