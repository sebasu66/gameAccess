import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { KeyRound, X } from "lucide-react";
import { ACTIVATION_CHANGED_EVENT, getActivationTier, getRegularAccess } from "./activation";
import { useI18n } from "./i18n";

const subscribe = (listener: () => void) => {
  window.addEventListener(ACTIVATION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ACTIVATION_CHANGED_EVENT, listener);
};
export default function AccessPass() {
  const { t, locale } = useI18n();
  const access = useSyncExternalStore(subscribe, getRegularAccess, () => null);
  const tier = useSyncExternalStore(subscribe, getActivationTier, () => null);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  if (!tier) return null;
  if (!access) return <div className="ga-access-pass"><span className="ga-access-pass-toggle">
    <KeyRound size={20} aria-hidden="true" />{tier.toUpperCase()}
  </span></div>;
  const expiry = new Date(access.expires_at).toLocaleString(locale === "es" ? "es-AR" : "en-US",
    { dateStyle: "medium", timeStyle: "short" });
  return <div className="ga-access-pass">
    {open ? <section id={id} className="ga-access-pass-panel" aria-labelledby={id + "-title"}>
      <header><h2 id={id + "-title"}>{t("accessPassTitle")}</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label={t("accessPassClose")}><X size={20} /></button></header>
      <strong className="ga-access-pass-tier" data-tier={access.access_tier}>{access.access_tier.toUpperCase()}</strong>
      <span>{t("activationKeyLabel")}</span>
      {access.key ? <code>{access.key}</code> : <p>{t("accessPassLegacy")}</p>}
      <span>{t("accessPassExpires")}</span><time dateTime={access.expires_at}>{expiry}</time>
    </section> : null}
    <button type="button" className="ga-access-pass-toggle" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}><KeyRound size={20} aria-hidden="true" />{t("accessPassTitle")} · {access.access_tier.toUpperCase()}</button>
  </div>;
}
