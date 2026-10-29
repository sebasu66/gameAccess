import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRight, Check, EyeOff, Lock, MonitorPlay, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { showNotice } from "./notice/notice";
import { hasTauriRuntime } from "./native";
import { dur, gsap, motionOk } from "./motion/gsap";
import { setAdminKey, useAdminKey, type AdminKeyState } from "./accessRole";
import { applyKidDraft, KidApplyError, setKidDraft, useKidState, usePlus, validKidName } from "./kidMode";
import { validWord } from "./AdminKeySection";
import ParentalControlSection from "./ParentalControlSection";
import KidGamesGrid from "./KidGamesGrid";

/**
 * Kids screen while kid mode is off (vault/Modo niño.md): the page that explains the features always comes first,
 * with or without PLUS. "Start" (PLUS only) adds the steps below it one by one, scrolling down to each: the parent's
 * key, the adult content filter, the child's account and the child's games. Finishing creates the account, and kid
 * mode is on.
 */
type Step = 0 | 1 | 2 | 3 | 4;

/** Translates a failed "create the account" into words. */
export function applyErrorText(failure: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  const code = failure instanceof KidApplyError ? failure.code : String(failure);
  if (code === "cancelled") return t("kidApplyCancelled");
  if (code === "needs_plus") return t("kidNeedsPlus");
  if (code === "not_program_files") return t("kidNotProgramFiles");
  if (code === "bad_name") return t("kidBadName");
  return t("kidApplyFailed", { error: code });
}

function Intro({ plus, started, onStart, onPlus }: { plus: boolean; started: boolean; onStart: () => void; onPlus: () => void }) {
  const { t } = useI18n();
  const features = [
    { icon: <EyeOff size={22} aria-hidden="true" />, title: t("kidFeatFilterTitle"), lines: [t("kidFeatFilterText")] },
    { icon: <Lock size={22} aria-hidden="true" />, title: t("kidFeatLockTitle"), lines: [t("kidFeatLockText")] },
    { icon: <MonitorPlay size={22} aria-hidden="true" />, title: t("kidFeatAccountTitle"), lines: [t("kidFeatAccountText"), t("kidFeatAccountOnly"), t("kidFeatAccountTime")] },
  ];
  return <section className="ga-kid-intro ga-stack">
    <div className="ga-stack ga-stack-sm"><span className="eyebrow">{t("kidIntroEyebrow")}</span><h3 className="ga-heading">{t("familyAskTitle")}</h3></div>
    <p>{t("kidIntroLead")}</p>
    <ul className="ga-kid-benefits">{features.map(item => <li key={item.title}><span className="ga-kid-benefit-icon">{item.icon}</span>
      <div className="ga-stack ga-stack-sm"><strong>{item.title}</strong>{item.lines.map(line => <p key={line} className="ga-hint">{line}</p>)}</div></li>)}</ul>
    {started ? null : <div className="ga-actions">
      <GaButton variant="primary" icon={plus ? <ArrowRight size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />} aria-disabled={!plus} onClick={() => { if (plus) onStart(); }}>{plus ? t("kidIntroStart") : t("kidIntroLocked")}</GaButton>
      {plus ? null : <GaButton icon={<Sparkles size={16} aria-hidden="true" />} onClick={onPlus}>{t("kidIntroKnowPlus")}</GaButton>}
    </div>}
  </section>;
}

/** One step of the wizard: its number and title, its content, and (while it is the current one) Next and Cancel. */
function StepBlock({ index, current, title, children, next, nextLabel, nextIcon, nextDisabled, onCancel }: {
  index: number; current: number; title: string; children: ReactNode; next: () => void; nextLabel: string; nextIcon?: ReactNode; nextDisabled?: boolean; onCancel: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const done = current > index;
  // A new step slides in and the dialog scrolls down to it.
  useEffect(() => {
    const block = ref.current;
    if (!block) return;
    block.scrollIntoView?.({ behavior: motionOk() ? "smooth" : "auto", block: "start" });
    const tween = gsap.from(block, { autoAlpha: 0, y: 28, duration: dur(0.5), ease: "power2.out" });
    return () => { tween.revert(); };
  }, []);
  return <section ref={ref} className={done ? "ga-kid-step ga-stack is-done" : "ga-kid-step ga-stack"}>
    <div className="ga-stack ga-stack-sm">
      <span className="eyebrow">{done ? <><Check size={12} aria-hidden="true" /> {t("kidStepDone", { step: String(index) })}</> : t("kidStepOf", { step: String(index) })}</span>
      <h3 className="ga-heading">{title}</h3>
    </div>
    {children}
    {done ? null : <div className="ga-actions">
      <GaButton variant="primary" icon={nextIcon ?? <ArrowRight size={16} aria-hidden="true" />} disabled={nextDisabled} onClick={next}>{nextLabel}</GaButton>
      <GaButton onClick={onCancel}>{t("kidCancel")}</GaButton>
    </div>}
  </section>;
}

/** Step 1: the parent's key that closes the parents' functions (admin_key.rs). */
function useKeyStep(onDone: () => void) {
  const { t } = useI18n();
  const key = useAdminKey();
  const [word, setWord] = useState("");
  const [error, setError] = useState("");
  const save = async () => {
    if (key.enabled) { onDone(); return; }
    if (!validWord(word)) { setError(t("adminKeyBadWord")); return; }
    setError("");
    try {
      const next = hasTauriRuntime() ? await invoke<AdminKeyState>("admin_key_set", { word: word.trim(), current: null }) : { enabled: true, length: word.trim().length + 6 };
      setAdminKey(next);
      showNotice({ tone: "ok", title: t("adminKeySaved") });
      onDone();
    } catch (failure) { setError(t("adminKeyFailed", { error: String(failure) })); }
  };
  const body = <>
    <p>{t("kidKeyText")}</p>
    {key.enabled ? <p className="ga-status is-ok">{t("kidKeyAlready")}</p> : <label className="ga-field"><span>{t("adminKeyWord")}</span>
      <input value={word} maxLength={20} autoComplete="off" spellCheck={false} placeholder={t("adminKeyWordPlaceholder")} onChange={event => setWord(event.target.value.replace(/\s/g, ""))} /></label>}
    <p className="ga-hint">{t("adminKeyHow1")}</p>
    {error ? <p className="ga-status is-error" role="alert">{error}</p> : null}
  </>;
  return { body, save, ready: key.enabled || validWord(word) };
}

export default function KidWizard({ onPlus }: { onPlus: () => void }) {
  const { t } = useI18n();
  const plus = usePlus();
  const { draft } = useKidState();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const top = useRef<HTMLDivElement>(null);
  const keyStep = useKeyStep(() => setStep(2));
  const cancel = () => { setStep(0); setError(""); top.current?.scrollIntoView?.({ behavior: motionOk() ? "smooth" : "auto", block: "start" }); };
  const finish = async () => {
    if (!validKidName(draft.name)) { setError(t("kidBadName")); return; }
    setBusy(true); setError("");
    try {
      await applyKidDraft();
      showNotice({ tone: "ok", title: t("kidApplied", { name: draft.name }) });
    } catch (failure) { setError(applyErrorText(failure, t)); } finally { setBusy(false); }
  };
  return <div ref={top} className="ga-stack ga-stack-lg">
    <Intro plus={plus} started={step > 0} onStart={() => setStep(1)} onPlus={onPlus} />
    {step >= 1 ? <StepBlock index={1} current={step} title={t("kidKeyTitle")} next={() => void keyStep.save()} nextLabel={t("kidKeyNext")} nextDisabled={!keyStep.ready} onCancel={cancel}>{keyStep.body}</StepBlock> : null}
    {step >= 2 ? <StepBlock index={2} current={step} title={t("kidFilterTitle")} next={() => setStep(3)} nextLabel={t("kidFilterNext")} onCancel={cancel}>
      <p>{t("kidFilterText")}</p><ParentalControlSection />
    </StepBlock> : null}
    {step >= 3 ? <StepBlock index={3} current={step} title={t("kidAccountTitle")} next={() => setStep(4)} nextLabel={t("kidAccountNext")} nextDisabled={!validKidName(draft.name)} onCancel={cancel}>
      <ul className="ga-kid-how">{[t("kidHow1"), t("kidHow2"), t("kidHow3"), t("kidHow4")].map(line => <li key={line}><UserRound size={16} aria-hidden="true" /><p className="ga-hint">{line}</p></li>)}</ul>
      <label className="ga-field"><span>{t("kidStep1Label")}</span>
        <input value={draft.name} maxLength={20} placeholder={t("kidAccountPlaceholder")} onChange={event => setKidDraft({ name: event.target.value.trim() })} /></label>
      <p className="ga-hint">{t("kidAccountNoPassword")}</p>
    </StepBlock> : null}
    {step >= 4 ? <StepBlock index={4} current={step} title={t("kidGamesTitle")} next={() => void finish()} nextLabel={busy ? t("kidApplying") : t("kidFinish")} nextIcon={<ShieldCheck size={16} aria-hidden="true" />} nextDisabled={busy || !plus} onCancel={cancel}>
      <p>{t("kidGamesText")}</p>
      <KidGamesGrid />
      <p className="ga-hint">{t("kidFinishHint")}</p>
      {error ? <p className="ga-status is-error" role="alert">{error}</p> : null}
    </StepBlock> : null}
  </div>;
}
