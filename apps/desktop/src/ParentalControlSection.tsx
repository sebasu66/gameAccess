import { useState, useSyncExternalStore } from "react";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { checkParentalPassword, getParentalState, isParentalLocked, ParentalError, saveParentalPolicy, subscribeParentalPolicy, type ParentalLevel, type ParentalPolicy } from "./parentalControl";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";

/** Reactive view of the enforced state, for any panel that must reflect it. */
export function useParentalLocked(): boolean {
  return useSyncExternalStore(subscribeParentalPolicy, isParentalLocked, () => false);
}

/** Reactive view of the whole state (policy and password), so edits re-render the controls. */
export function useParentalState() {
  return useSyncExternalStore(subscribeParentalPolicy, getParentalState, getParentalState);
}

type Translate = ReturnType<typeof useI18n>["t"];

/** The words for a refused change. */
export function parentalErrorText(error: unknown, t: Translate): string {
  if (error instanceof ParentalError) {
    if (error.code === "wrong_password") return t("parentalWrongPassword");
    if (error.code === "retry_later") return t("parentalRetryLater", { seconds: String(error.retryAfterSeconds) });
    if (error.code === "password_too_short") return t("parentalPasswordTooShort");
  }
  return t("parentalSaveFailed", { error: error instanceof Error ? error.message : String(error) });
}

/** The two fields that create or replace the password (`current` is the password in use), and their save. */
export function useNewParentalPassword(current: string | undefined, onSaved: (password: string) => void, autoFocus = false) {
  const { t } = useI18n();
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (first.length < 4) return setError(t("parentalPasswordTooShort"));
    if (first !== second) return setError(t("parentalPasswordsDiffer"));
    setBusy(true);
    setError("");
    try {
      await saveParentalPolicy({}, { password: current, newPassword: first });
      onSaved(first);
    } catch (failure) {
      setError(parentalErrorText(failure, t));
    } finally {
      setBusy(false);
    }
  };
  const onEnter = (event: React.KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); void save(); } };
  const fields = <>
    <label className="ga-field"><span>{t("parentalNewPassword")}</span>
      <input type="password" autoComplete="new-password" value={first} autoFocus={autoFocus} disabled={busy} onChange={e => setFirst(e.target.value)} onKeyDown={onEnter} /></label>
    <label className="ga-field"><span>{t("parentalRepeatPassword")}</span>
      <input type="password" autoComplete="new-password" value={second} disabled={busy} onChange={e => setSecond(e.target.value)} onKeyDown={onEnter} /></label>
    {error ? <p className="ga-parental-error" role="alert">{error}</p> : null}
  </>;
  return { fields, save, busy, ready: Boolean(first) && !busy };
}

function ParentalPasswordForm({ current, onSaved }: { current?: string; onSaved: (password: string) => void }) {
  const { t } = useI18n();
  const form = useNewParentalPassword(current, onSaved);
  return <div className="ga-parental-password">
    {form.fields}
    <GaButton variant="primary" disabled={!form.ready} onClick={() => void form.save()}>{t("parentalSavePassword")}</GaButton>
  </div>;
}

/**
 * Parental policy editor.
 *
 * These criteria are NEGATIVE only: they remove content, never search for it.
 * That is why they show "solo excluir" instead of the include/exclude pair the
 * other groups use, and why the rest of the panel's content discovery is
 * disabled while a policy is enforced. With a password, the options stay
 * read-only until it is typed; it is kept only while this panel is open.
 */
export default function ParentalControlSection() {
  const { t } = useI18n();
  const { policy, hasPassword } = useParentalState();
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [changing, setChanging] = useState(false);
  const locked = policy.enabled && policy.level !== "off";
  const editable = !hasPassword || password !== undefined;
  const save = async (change: Partial<ParentalPolicy>) => {
    setError("");
    setNotice("");
    try {
      await saveParentalPolicy(change, { password });
    } catch (failure) {
      setError(parentalErrorText(failure, t));
    }
  };
  const unlock = async () => {
    setError("");
    try {
      await checkParentalPassword(typed);
      setPassword(typed);
      setTyped("");
    } catch (failure) {
      setError(parentalErrorText(failure, t));
    }
  };
  const levels: { id: ParentalLevel; label: string; detail: string }[] = [
    { id: "off", label: t("parentalOff"), detail: t("parentalOffDetail") },
    { id: "adult-only", label: t("parentalAdultOnly"), detail: t("parentalAdultOnlyDetail") },
    { id: "strict", label: t("parentalStrict"), detail: t("parentalStrictDetail") },
  ];
  return <details className={"ga-filter-accordion ga-parental" + (locked ? " is-locked" : "")} open>
    <summary>
      {locked ? <Lock size={12} aria-hidden="true" /> : <ShieldCheck size={12} aria-hidden="true" />}
      {t("parentalTitle")}
      {locked ? <small className="ga-filter-locked-note">{t("uiActivo")}</small> : null}
    </summary>
    <p className="ga-parental-note">
      {t("parentalNoteBefore")}<strong>{t("uiExcluyen")}</strong>{t("parentalNoteAfter")}
    </p>
    <div className="ga-parental-levels">
      {levels.map(({ id, label, detail }) => <label key={id} title={detail}>
        <input type="radio" name="ga-parental-level" disabled={!editable} checked={policy.level === id && (id === "off" || policy.enabled)} onChange={() => void save({ enabled: id !== "off", level: id })} />
        <span>{label}<small>{detail}</small></span>
      </label>)}
    </div>
    <label className="ga-parental-violence">
      <input type="checkbox" tabIndex={-1} disabled={!editable} checked={policy.hideViolence} onChange={event => void save({ hideViolence: event.target.checked })} />
      <span>{t("uiOcultarTambienViolenciaY")}<small>{t("uiDescriptor2DeValve")}</small></span>
    </label>
    <div className="ga-parental-access">
      <p className={"ga-parental-status" + (hasPassword ? " is-protected" : "")}>
        <KeyRound size={13} aria-hidden="true" />{hasPassword ? t("parentalPasswordOn") : t("parentalPasswordMissing")}
      </p>
      {!editable ? <>
        <p className="ga-parental-note">{t("parentalLockedHint")}</p>
        <div className="ga-parental-unlock">
          <label className="ga-field"><span>{t("parentalPasswordField")}</span>
            <input type="password" autoComplete="current-password" value={typed} onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void unlock(); } }} /></label>
          <GaButton variant="primary" disabled={!typed} onClick={() => void unlock()}>{t("parentalUnlock")}</GaButton>
        </div>
      </> : !hasPassword || changing ? <ParentalPasswordForm current={password} onSaved={next => { setPassword(next); setChanging(false); setNotice(t("parentalPasswordSaved")); }} />
        : <GaButton onClick={() => { setChanging(true); setNotice(""); }}>{t("parentalChangePassword")}</GaButton>}
      {error ? <p className="ga-parental-error" role="alert">{error}</p> : null}
      {notice ? <p className="ga-parental-saved" role="status">{notice}</p> : null}
    </div>
  </details>;
}
