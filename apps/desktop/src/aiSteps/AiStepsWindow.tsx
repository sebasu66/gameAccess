import { useState, type ClipboardEvent, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { GaButton } from "../components/ga/Buttons";
import { aiOpenKeysInBrowser, aiSaveKey, looksLikeKey } from "../aiConnection";
import { useI18n } from "../i18n";

import step1 from "./step-1.png";
import step2 from "./step-2.png";
import step3 from "./step-3.png";
import step4 from "./step-4.png";

/**
 * The small window that stays on top while the player is in their browser (ai_connection.rs, docs/GUI_DESIGN.md §4.29):
 * the steps with a screenshot of each Ollama screen, and the field for the key. A pasted key that looks right is sent at
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
    <header className="ga-steps-head">
      <h1 className="ga-steps-title">{t("aiStepsTitle")}</h1>
      <GaButton icon={<ExternalLink size={18} aria-hidden="true" />} onClick={() => void aiOpenKeysInBrowser()}>{t("aiStepsReopen")}</GaButton>
    </header>
    <ol className="ga-steps-list">
      <Step number={1} title={t("aiStep1")} image={step1} tall />
      <Step number={2} title={t("aiStep2")} image={step2} />
      <Step number={3} title={t("aiStep3")} image={step3} />
      <Step number={4} title={t("aiStep4")} image={step4}>
        <input className="ga-steps-key" aria-label={t("aiPasteLabel")} placeholder={t("aiStepsPaste")} value={key} disabled={busy} autoComplete="off" spellCheck={false}
          onPaste={onPaste} onChange={event => { setKey(event.target.value); setBad(false); }}
          onKeyDown={event => { if (event.key === "Enter") void send(key); }} />
        {bad ? <p role="alert" className="ga-status is-error">{t("aiBadKey")}</p> : null}
      </Step>
    </ol>
  </main>;
}

function Step({ number, title, image, tall, children }: { number: number; title: string; image: string; tall?: boolean; children?: ReactNode }) {
  return <li className="ga-step">
    <h2 className="ga-step-title"><span className="ga-step-number" aria-hidden="true">{number}</span>{title}</h2>
    <img className={tall ? "ga-step-shot is-tall" : "ga-step-shot"} src={image} alt="" />
    {children}
  </li>;
}
