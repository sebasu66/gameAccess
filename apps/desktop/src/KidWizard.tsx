import { useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowRight, Check, EyeOff, Lock, MonitorPlay, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { showNotice } from "./notice/notice";
import { hasTauriRuntime } from "./native";
import { dur, gsap, useGSAP } from "./motion/gsap";
import { loadAdminKey, setAdminKey, useAdminKey, type AdminKeyState } from "./accessRole";
import { applyKidDraft, KidApplyError, setKidDraft, useKidState, usePlus, validKidName } from "./kidMode";
import { validWord } from "./AdminKeySection";
import ParentalControlSection from "./ParentalControlSection";
import KidGamesGrid from "./KidGamesGrid";
import { DaySchedule } from "./KidTime";

/**
 * Kids screen while kid mode is off (vault/Modo niño.md): the page that explains the features always comes first,
 * with or without PLUS. "Start" (PLUS only) opens the steps, one at a time in a stage of fixed height (the dialog never
 * grows): the parent's key, the adult content filter, the child's account and the child's games. Back returns without
 * losing anything; finishing saves the parent's key and creates the account, and only then kid mode and the parent's
 * key are on (an unfinished wizard leaves nothing that the opening asks for, admin_key.rs).
 * Stage: prototype (docs, logs, new translations and unit tests still pending).
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

function Intro() {
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
  </section>;
}

/** Step 1: the parent's key that closes the parents' functions (admin_key.rs). The word is only checked here; `keep`
 *  saves it when the wizard finishes. */
function useKeyStep(onDone: () => void) {
  const { t } = useI18n();
  const key = useAdminKey();
  const [word, setWord] = useState("");
  const [error, setError] = useState("");
  const save = () => {
    if (key.enabled) { onDone(); return; }
    if (!validWord(word)) { setError(t("adminKeyBadWord")); return; }
    setError("");
    onDone();
  };
  const keep = async () => {
    if (key.enabled) return;
    const next = hasTauriRuntime() ? await invoke<AdminKeyState>("admin_key_set", { word: word.trim(), current: null }) : { enabled: true, length: word.trim().length };
    setAdminKey(next);
  };
  const body = <>
    <p>{t("kidKeyText")}</p>
    {key.enabled ? <p className="ga-status is-ok">{t("kidKeyAlready")}</p> : <label className="ga-field"><span>{t("adminKeyWord")}</span>
      <input value={word} maxLength={40} autoComplete="off" spellCheck={false} placeholder={t("adminKeyWordPlaceholder")} onChange={event => setWord(event.target.value.replace(/\s/g, ""))} /></label>}
    <p className="ga-hint">{t("adminKeyHow1")}</p>
    {error ? <p className="ga-status is-error" role="alert">{error}</p> : null}
  </>;
  return { body, save, keep, enabled: key.enabled, ready: key.enabled || validWord(word) };
}

type StepView = { title: string; body: ReactNode; next: () => void; nextLabel: string; nextIcon?: ReactNode; nextDisabled?: boolean };

/** What the wizard's last dialog (KidReadyDialog.tsx) needs: the child, whether the parent's Windows account has a
 *  password (null: could not be told) and whether the child's games include Steam ones. */
export interface KidReady { name: string; protectedAccount: boolean | null; steam: boolean }

export default function KidWizard({ onPlus, onReady }: { onPlus: () => void; onReady: (ready: KidReady) => void }) {
  const { t } = useI18n();
  const plus = usePlus();
  const { draft } = useKidState();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const previous = useRef<Step>(0);
  const go = (next: Step) => { setError(""); setStep(next); };
  const keyStep = useKeyStep(() => go(2));
  const finish = async () => {
    if (!validKidName(draft.name)) { setError(t("kidBadName")); return; }
    setBusy(true); setError("");
    try {
      // The key first: until the account exists it stays asleep, and a failed account leaves kid mode off.
      try { await keyStep.keep(); } catch (failure) { setError(t("adminKeyFailed", { error: String(failure) })); return; }
      const steam = draft.games.some(game => game.steam);
      await applyKidDraft();
      if (hasTauriRuntime()) await loadAdminKey().catch(() => undefined);
      // Asked once the account exists (it counts as one failed sign-in on a protected account: windows_account.rs).
      const protectedAccount = hasTauriRuntime() ? await invoke<boolean | null>("windows_account_protected").catch(() => null) : null;
      onReady({ name: draft.name, protectedAccount, steam });
    } catch (failure) {
      // Said where it cannot be missed: the single notice (which does not close by itself on an error) and beside the
      // buttons. kidMode.ts has already logged it and sent it to the server.
      const text = applyErrorText(failure, t);
      setError(text);
      showNotice({ tone: "error", title: t("kidApplyFailedTitle"), text });
    } finally { setBusy(false); }
  };
  // A new step comes in from below (from above when going back) and the stage starts at its top.
  useGSAP(() => {
    const el = stage.current;
    if (!el) return;
    el.scrollTop = 0;
    const from = previous.current;
    previous.current = step;
    if (from === step || !el.firstElementChild) return;
    gsap.fromTo(el.firstElementChild, { autoAlpha: 0, y: step > from ? 32 : -32 },
      { autoAlpha: 1, y: 0, duration: dur(0.32), ease: "power2.out", overwrite: "auto", clearProps: "transform,opacity,visibility" });
  }, { scope: stage, dependencies: [step] });
  const views: Record<1 | 2 | 3 | 4, StepView> = {
    1: { title: t("kidKeyTitle"), body: keyStep.body, next: keyStep.save, nextLabel: t("kidKeyNext"), nextDisabled: !keyStep.ready },
    2: { title: t("kidFilterTitle"), body: <><p>{t("kidFilterText")}</p><ParentalControlSection /></>, next: () => go(3), nextLabel: t("kidFilterNext") },
    3: {
      title: t("kidAccountTitle"), next: () => go(4), nextLabel: t("kidAccountNext"), nextDisabled: !validKidName(draft.name),
      body: <>
        <ul className="ga-kid-how">{[t("kidHow1"), t("kidHow2"), t("kidHow3"), t("kidHow4")].map(line => <li key={line}><UserRound size={16} aria-hidden="true" /><p className="ga-hint">{line}</p></li>)}</ul>
        <label className="ga-field"><span>{t("kidStep1Label")}</span>
          <input value={draft.name} maxLength={20} placeholder={t("kidAccountPlaceholder")} onChange={event => setKidDraft({ name: event.target.value.trim() })} /></label>
        <p className="ga-hint">{t("kidAccountNoPassword")}</p>
        <DaySchedule draft={draft} />
      </>,
    },
    4: {
      title: t("kidGamesTitle"), next: () => void finish(), nextLabel: busy ? t("kidApplying") : t("kidFinish"), nextIcon: <ShieldCheck size={16} aria-hidden="true" />, nextDisabled: busy || !plus,
      body: <>
        <p>{t("kidGamesText")}</p>
        <KidGamesGrid />
        <p className="ga-hint">{t("kidFinishHint")}</p>
      </>,
    },
  };
  const view = step === 0 ? null : views[step];
  return <div className="ga-kid-wizard" data-stage="prototype">
    {view ? <ol className="ga-kid-progress">{([1, 2, 3, 4] as const).map(index => {
      const done = step > index;
      const label = done ? t("kidStepDone", { step: String(index) }) : t("kidStepOf", { step: String(index) });
      return <li key={index} aria-label={label} aria-current={step === index ? "step" : undefined}>
        {done
          ? <button type="button" className="ga-kid-chip is-done" aria-label={label} onClick={() => go(index)}><Check size={12} aria-hidden="true" />{index}</button>
          : <span className={step === index ? "ga-kid-chip is-current" : "ga-kid-chip"} aria-hidden="true">{index}</span>}
      </li>;
    })}</ol> : null}
    <div ref={stage} className="ga-kid-stage">
      {view ? <section className="ga-kid-step ga-stack"><h3 className="ga-heading">{view.title}</h3>{view.body}</section> : <Intro />}
    </div>
    {view && error ? <p className="ga-status is-error" role="alert">{error}</p> : null}
    <div className="ga-kid-foot">
      {view ? <>
        <GaButton icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => go((step - 1) as Step)}>{t("kidBack")}</GaButton>
        <GaButton variant="primary" icon={view.nextIcon ?? <ArrowRight size={16} aria-hidden="true" />} disabled={view.nextDisabled} onClick={view.next}>{view.nextLabel}</GaButton>
      </> : <div className="ga-actions">
        <GaButton variant="primary" icon={plus ? <ArrowRight size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />} aria-disabled={!plus} onClick={() => { if (plus) go(keyStep.enabled ? 2 : 1); }}>{plus ? t("kidIntroStart") : t("kidIntroLocked")}</GaButton>
        {plus ? null : <GaButton icon={<Sparkles size={16} aria-hidden="true" />} onClick={onPlus}>{t("kidIntroKnowPlus")}</GaButton>}
      </div>}
    </div>
  </div>;
}
