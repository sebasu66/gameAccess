import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, ExternalLink, Eye, KeyRound, Sparkles, UserRound, X } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "./components/ui/alert-dialog";
import { GaButton, GaClose } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { aiDisconnect, aiGuideOpen, aiOpenKeysInBrowser, aiSaveKey, aiTest, aiTestError, listenAiGuide, looksLikeKey, type AiTestError } from "./aiConnection";
import "./ai-connect.css";

type Step = "intro" | "guide" | "test";
type Test = { kind: "running" } | { kind: "ok"; model: string } | { kind: "error"; error: AiTestError };
type Note = { tone: "warn" | "error"; text: string };

/**
 * "Connect AI" (Seba, 2026-11-04; docs/GUI_DESIGN.md §4.29): three steps in one large dialog.
 * 1. What it does and what goes to Ollama. 2. Ollama's key page opens in a Game Access window with a guide over it
 * (ollama_guide.js): it points at what to press to sign up or sign in and to create the key, and takes the key itself.
 * Google does not sign in inside an app's window: choosing it there opens the player's browser, and the key is pasted.
 * 3. The key is tried with the free model; "Done" closes. `onDone` gets whether a key is now kept.
 */
export default function AiConnectWizard({ onDone }: { onDone: (connected: boolean) => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("intro");
  const [note, setNote] = useState<Note | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<Test>({ kind: "running" });

  const runTest = useCallback(async () => {
    setStep("test"); setTest({ kind: "running" });
    try { setTest({ kind: "ok", model: await aiTest() }); } catch (error) { setTest({ kind: "error", error: aiTestError(error) }); }
  }, []);

  useEffect(() => listenAiGuide({
    key: () => { setWindowOpen(false); void runTest(); },
    google: () => setNote({ tone: "warn", text: t("aiGoogleNote") }),
    closed: saved => { setWindowOpen(false); if (!saved) setNote(current => current ?? { tone: "warn", text: t("aiGuideClosed") }); },
  }), [runTest, t]);

  const openGuide = async () => {
    setNote(null); setStep("guide");
    try { await aiGuideOpen(); setWindowOpen(true); } catch { setNote({ tone: "error", text: t("aiGuideFailed") }); }
  };
  const usePasted = async () => {
    setBusy(true); setNote(null);
    try { await aiSaveKey(pasted); setPasted(""); await runTest(); } catch { setNote({ tone: "error", text: t("aiBadKey") }); } finally { setBusy(false); }
  };
  const tryAnother = async () => { await aiDisconnect().catch(() => undefined); setNote(null); setStep("guide"); };
  const connected = test.kind === "ok" || (test.kind === "error" && test.error === "limit");
  const close = () => onDone(step === "test" && connected);

  const number = step === "intro" ? 1 : step === "guide" ? 2 : 3;
  const title = step === "intro" ? t("aiIntroTitle") : step === "guide" ? t("aiGuideTitle")
    : test.kind === "running" ? t("aiTesting") : connected ? t("aiConnected") : t("aiTestFailedTitle");

  return <AlertDialog open onOpenChange={next => { if (!next && !busy) close(); }}>
    <AlertDialogContent className="ga-overlay-dialog ga-ai" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <header className="ga-ai-head">
        <div className="ga-ai-titles">
          <span className="eyebrow">{t("aiEyebrow", { step: number, total: 3 })}</span>
          <AlertDialogTitle className="ga-ai-title">{title}</AlertDialogTitle>
          <div className="ga-ai-steps" aria-hidden="true">{[1, 2, 3].map(index => <i key={index} className={index <= number ? "is-done" : undefined} />)}</div>
        </div>
        <GaClose label={t("close")} onClick={close} disabled={busy} />
      </header>
      <div className="ga-ai-scroll">
        {step === "intro" ? <>
          <AlertDialogDescription className="ga-ai-lead">{t("aiIntroLead")}</AlertDialogDescription>
          <section className="ga-ai-notes">
            <Card tone="ok" icon={<Sparkles size={20} aria-hidden="true" />} title={t("aiWhatTitle")} items={[t("aiWhat1"), t("aiWhat2"), t("aiWhat3")]} />
            <Card tone="warn" icon={<Eye size={20} aria-hidden="true" />} title={t("aiSentTitle")} items={[t("aiSent1"), t("aiSent2"), t("aiSent3")]} />
          </section>
          <p className="ga-hint ga-ai-gap">{t("aiFreeHint")}</p>
        </> : null}

        {step === "guide" ? <>
          <AlertDialogDescription className="ga-ai-lead">{t("aiGuideLead")}</AlertDialogDescription>
          <section className="ga-ai-notes">
            <Card tone="violet" icon={<UserRound size={20} aria-hidden="true" />} title={t("aiAccountTitle")} text={t("aiAccountText")} />
            <Card tone="warn" icon={<KeyRound size={20} aria-hidden="true" />} title={t("aiKeyTitle")} text={t("aiKeyText")} />
          </section>
          {windowOpen && !note ? <p role="status" className="ga-ai-wait ga-ai-gap"><span className="ga-ai-spin" aria-hidden="true" />{t("aiWaiting")}</p> : null}
          {note ? <p role="status" className={`ga-status is-${note.tone} ga-ai-gap`}>{note.text}</p> : null}
          <section className="ga-ai-section">
            <h3 className="ga-label">{t("aiBrowserLabel")}</h3>
            <p className="ga-hint">{t("aiBrowserHint")}</p>
            <div className="ga-ai-paste">
              <input className="ga-field ga-ai-field" aria-label={t("aiPasteLabel")} placeholder={t("aiPastePlaceholder")} value={pasted} autoComplete="off" spellCheck={false}
                onChange={event => setPasted(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && looksLikeKey(pasted)) void usePasted(); }} />
              <GaButton icon={<ExternalLink size={18} aria-hidden="true" />} onClick={() => void aiOpenKeysInBrowser()}>{t("aiOpenBrowser")}</GaButton>
            </div>
          </section>
        </> : null}

        {step === "test" ? <div className="ga-ai-result">
          <span className={`ga-ai-big is-${test.kind === "running" ? "running" : connected ? "ok" : "error"}`} aria-hidden="true">
            {test.kind === "running" ? <span className="ga-ai-spin is-big" /> : connected ? <Check size={34} /> : <X size={34} />}
          </span>
          <div className="ga-ai-checks">
            {test.kind === "error" && !connected ? <p role="status" className="ga-ai-lead">{t(`aiError_${test.error}`)}</p> : <ul>
              <li className={test.kind === "running" ? "is-pending" : undefined}><Check size={16} aria-hidden="true" />{t("aiCheckKey")}</li>
              <li className={test.kind === "running" ? "is-pending" : undefined}><Check size={16} aria-hidden="true" />{t("aiCheckModel", { model: test.kind === "ok" ? test.model : "gemma4" })}</li>
              <li className={test.kind === "running" ? "is-pending" : undefined}><Check size={16} aria-hidden="true" />{t("aiCheckSaved")}</li>
            </ul>}
            {test.kind === "error" && test.error === "limit" ? <p role="status" className="ga-status is-warn">{t("aiError_limit")}</p> : null}
            {connected ? <p className="ga-hint">{t("aiDoneHint")}</p> : null}
          </div>
        </div> : null}
      </div>
      <footer className="ga-ai-foot ga-actions">
        {step === "intro" ? <>
          <GaButton onClick={close}>{t("aiNotNow")}</GaButton>
          <GaButton variant="primary" onClick={() => void openGuide()}>{t("aiConnect")}</GaButton>
        </> : null}
        {step === "guide" ? <>
          <GaButton className="ga-ai-back" onClick={() => { setNote(null); setStep("intro"); }}>{t("aiBack")}</GaButton>
          <GaButton onClick={() => void openGuide()}>{windowOpen ? t("aiShowWindow") : t("aiOpenWindow")}</GaButton>
          <GaButton variant="primary" disabled={busy || !looksLikeKey(pasted)} onClick={() => void usePasted()}>{t("aiUseKey")}</GaButton>
        </> : null}
        {step === "test" ? test.kind === "running" ? null : connected
          ? <GaButton variant="primary" onClick={close}>{t("aiDone")}</GaButton>
          : test.error === "rejected" || test.error === "no_key"
            ? <GaButton variant="primary" onClick={() => void tryAnother()}>{t("aiTryAnother")}</GaButton>
            : <><GaButton onClick={close}>{t("aiLater")}</GaButton><GaButton variant="primary" onClick={() => void runTest()}>{t("aiRetry")}</GaButton></> : null}
      </footer>
    </AlertDialogContent>
  </AlertDialog>;
}

function Card({ tone, icon, title, text, items }: { tone: "ok" | "warn" | "violet"; icon: ReactNode; title: string; text?: string; items?: string[] }) {
  return <article className={`ga-ai-note is-${tone}`}>
    <span className="ga-ai-note-icon">{icon}</span>
    <div className="ga-ai-note-body">
      <h4 className="ga-ai-note-title">{title}</h4>
      {text ? <p>{text}</p> : null}
      {items ? <ul>{items.map(item => <li key={item}>{item}</li>)}</ul> : null}
    </div>
  </article>;
}
