import { GaClose } from "./components/ga/Buttons";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { formatRemaining } from "./activationLifetime";
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
  const [now, setNow] = useState(() => Date.now());
  const id = useId();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  if (!tier) return null;
  if (!access) return <div className="ga-access-pass"><span className="ga-access-pass-toggle">
    <KeyRound size={18} aria-hidden="true" /><strong>{tier.toUpperCase()}</strong>
  </span></div>;
  // Base access is timed, so show how long is left; Plus shows only its badge.
  const remaining = access.access_tier === "base" ? formatRemaining(new Date(access.expires_at).getTime() - now) : "";
  const expiry = new Date(access.expires_at).toLocaleString(locale === "es" ? "es-AR" : "en-US",
    { dateStyle: "medium", timeStyle: "short" });
  return <div className="ga-access-pass">
    {open ? <section id={id} className="ga-access-pass-panel" aria-labelledby={id + "-title"}>
      <header><h2 id={id + "-title"}>{t("accessPassTitle")}</h2>
        <GaClose label={t("accessPassClose")} onClick={() => setOpen(false)} /></header>
      <strong className="ga-access-pass-tier" data-tier={access.access_tier}>{access.access_tier.toUpperCase()}</strong>
      <span>{t("activationKeyLabel")}</span>
      {access.key ? <code>{access.key}</code> : <p>{t("accessPassLegacy")}</p>}
      <span>{t("accessPassExpires")}</span><time dateTime={access.expires_at}>{expiry}</time>
    </section> : null}
    <button type="button" className="ga-access-pass-toggle" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-label={`${t("accessPassTitle")}: ${access.access_tier.toUpperCase()}${remaining ? ` · ${remaining}` : ""}`}
      title={remaining ? `${t("accessPassExpires")}: ${expiry}` : undefined}
      onClick={() => setOpen(value => !value)}><KeyRound size={18} aria-hidden="true" /><strong>{access.access_tier.toUpperCase()}</strong>{remaining ? <span className="ga-access-time">{remaining}</span> : null}</button>
  </div>;
}
