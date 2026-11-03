import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { LogIn, LogOut, UserPlus, UserRound } from "lucide-react";
import { ACCOUNT_CHANGED_EVENT, getAccount, refreshAccount, registerAccount, signInAccount, signOutAccount, type AccountResult } from "./account";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";

const subscribe = (listener: () => void) => {
  window.addEventListener(ACCOUNT_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, listener);
};

const RESULT_TEXT = {
  offline: "accountOffline", too_many: "accountTooMany", invalid_email: "accountInvalidEmail", invalid_password: "accountInvalidPassword",
  invalid_name: "accountInvalidName", email_taken: "accountEmailTaken", bad_credentials: "accountBadCredentials", failed: "accountFailed",
} as const;

/** Home's "My account" card (vault/Tareas.md L3): create an account or sign in; signed in, the name and the PLUS. */
export default function AccountCard() {
  const { t, locale } = useI18n();
  const account = useSyncExternalStore(subscribe, getAccount, () => null);
  const [mode, setMode] = useState<"register" | "signin">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<Exclude<AccountResult, "ok"> | null>(null);
  useEffect(() => { void refreshAccount(); }, []);

  const register = mode === "register";
  const ready = email.trim() !== "" && password !== "" && (!register || name.trim() !== "") && !working;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setWorking(true); setResult(null);
    const outcome = register ? await registerAccount({ name, email, password, language: locale }) : await signInAccount({ email, password });
    setWorking(false);
    if (outcome === "ok") { setPassword(""); setName(""); }
    else setResult(outcome);
  };

  return <section className="ga-home-card ga-home-account" aria-labelledby="ga-home-account-title">
    <h3 id="ga-home-account-title" className="ga-home-card-title"><UserRound size={20} aria-hidden="true" />{t("accountTitle")}</h3>
    {account ? <div className="ga-home-account-row">
      <div className="ga-stack">
        <p>{t("accountSignedIn", { name: account.name, email: account.email })}</p>
        <p className="ga-hint">{account.plus_active && account.plus_until
          ? t("accountPlusUntil", { date: new Date(account.plus_until).toLocaleDateString(locale) })
          : t("accountNoPlus")}</p>
      </div>
      <GaButton icon={<LogOut size={16} aria-hidden="true" />} onClick={() => void signOutAccount()}>{t("accountSignOut")}</GaButton>
    </div> : <form className="ga-home-account-form ga-stack" data-no-autofocus onSubmit={submit}>
      <p>{t("accountIntro")}</p>
      {register ? <label className="ga-field"><span>{t("accountName")}</span>
        <input value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)} /></label> : null}
      <label className="ga-field"><span>{t("accountEmail")}</span>
        <input type="email" value={email} maxLength={254} autoComplete="email" onChange={event => setEmail(event.target.value)} /></label>
      <label className="ga-field"><span>{t(register ? "accountPasswordNew" : "accountPassword")}</span>
        <input type="password" value={password} maxLength={200} autoComplete={register ? "new-password" : "current-password"} onChange={event => setPassword(event.target.value)} /></label>
      <div className="ga-actions">
        <GaButton type="submit" variant="primary" icon={register ? <UserPlus size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />} disabled={!ready}>
          {t(working ? "accountWorking" : register ? "accountCreate" : "accountSignIn")}</GaButton>
        <GaButton onClick={() => { setMode(register ? "signin" : "register"); setResult(null); }}>{t(register ? "accountHaveOne" : "accountNeedOne")}</GaButton>
      </div>
      {result ? <p className="ga-status is-error" role="status">{t(RESULT_TEXT[result])}</p> : null}
      {register ? null : <p className="ga-hint">{t("accountForgot")}</p>}
    </form>}
  </section>;
}
