import VoxelLogo from "./VoxelLogo";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, KeyRound, Loader2, PlayCircle } from "lucide-react";
import SplashScreen from "./SplashScreen";
import GameCoverBackdrop from "./GameCoverBackdrop";
import BackendStatus from "./BackendStatus";
import LanguageSwitch from "./LanguageSwitch";
import { openingStage } from "./openingFlow";
import { ACTIVATION_INVALID_EVENT, checkActivation, clearActivationSession, readActivationSession, redeemActivation } from "./activation";
import type { ActivationStatus } from "./activation";
import { useI18n } from "./i18n";
import { ACTIVATION_WARNING_MS, nextActivationTimerDelay } from "./activationLifetime";

const linkvertiseUrl = import.meta.env.VITE_LINKVERTISE_URL?.trim() || "";
const tutorialVideoUrl = import.meta.env.VITE_LINKVERTISE_HELP_VIDEO_URL?.trim() || "";

export default function ActivationGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [introReady, setIntroReady] = useState(false);
  const [verificationReady, setVerificationReady] = useState(false);
  const [docked, setDocked] = useState(false);
  const [dockStarted, setDockStarted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(() => window.location.hash === "#obtener-clave");

  const stage = openingStage({ introReady, verificationReady, approved: Boolean(status?.active), docked });
  const completeIntro = useCallback(() => setIntroReady(true), []);
  const startDock = useCallback(() => setDockStarted(true), []);
  const completeDock = useCallback(() => setDocked(true), []);
  useEffect(() => {
    const replay = () => { setIntroReady(false); setDocked(false); setDockStarted(false); };
    window.addEventListener("gameaccess:replay-logo", replay);
    return () => window.removeEventListener("gameaccess:replay-logo", replay);
  }, []);

  const verify = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const token = await readActivationSession();
      if (!token) { setStatus(null); return; }
      setStatus(await checkActivation(token));
    } catch (reason) {
      setStatus(null);
      setError(reason instanceof Error ? reason.message : t("activationVerifyFailed"));
    } finally { setBusy(false); setVerificationReady(true); }
  }, [t]);

  useEffect(() => { void verify(); }, [verify]);
  useEffect(() => {
    const syncHelpPage = () => setHelpOpen(window.location.hash === "#obtener-clave");
    window.addEventListener("hashchange", syncHelpPage);
    return () => window.removeEventListener("hashchange", syncHelpPage);
  }, []);
  useEffect(() => {
    const invalid = () => {
      setStatus(null);
      setNotice("");
      setError(t("activationExpiredHelp"));
      void clearActivationSession();
    };
    window.addEventListener(ACTIVATION_INVALID_EVENT, invalid);
    return () => window.removeEventListener(ACTIVATION_INVALID_EVENT, invalid);
  }, [t]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") void verify(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [verify]);
  useEffect(() => {
    if (!status) return;
    setNotice("");
    const initialRemaining = Date.parse(status.expires_at) - Date.parse(status.server_time);
    const observedAt = Date.now();
    let timer: number | undefined;
    let cancelled = false;

    const expire = () => {
      setStatus(null);
      setNotice("");
      setError(t("activationTimeEnded"));
      void clearActivationSession();
    };

    const tick = () => {
      if (cancelled) return;
      const remaining = initialRemaining - (Date.now() - observedAt);
      if (!Number.isFinite(remaining) || remaining <= 0) {
        expire();
        return;
      }
      if (remaining <= ACTIVATION_WARNING_MS) setNotice(t("activationExpiringSoon"));
      timer = window.setTimeout(tick, nextActivationTimerDelay(remaining));
    };

    tick();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [status, t]);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await redeemActivation(key));
      setKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("activationKeyFailed"));
    } finally { setBusy(false); setVerificationReady(true); }
  };

  return <>
    {status?.active && introReady ? <div className={`ga-application-reveal${dockStarted ? " is-revealing" : ""}${stage === "ready" ? " is-ready" : ""}`} aria-hidden={stage !== "ready"} ref={node => { if (node) node.inert = stage !== "ready"; }}>
      <div className="ga-access-brand"><VoxelLogo /></div>
      {children}
      {notice ? <div className="toast" role="status" aria-live="assertive">{notice}</div> : null}
    </div> : null}
    {stage !== "ready" ? <div className={`ga-opening-background${dockStarted && stage === "docking" ? " is-docking" : ""}`} data-stage={stage}><GameCoverBackdrop /></div> : null}
    {stage === "validation" ? <main className="runtime-gate activation-gate ga-validation">
      {helpOpen ? <section className="runtime-gate-card activation-card activation-help" aria-labelledby="activation-help-title">
        <a className="activation-back" href="#acceso"><ArrowLeft size={18} /> {t("activationBack")}</a>
        <div className="activation-card-heading"><div className="activation-key-mark"><PlayCircle size={24} /></div><span className="eyebrow">{t("activationFree")}</span></div>
        <h1 id="activation-help-title">{t("activationHelpTitle")}</h1>
        <p>{t("activationHelpLead")}</p>
        {tutorialVideoUrl ? <video className="activation-help-video" controls playsInline src={tutorialVideoUrl} aria-label={t("activationHelpVideo")} />
          : <div className="activation-video-pending"><PlayCircle size={38} /><span>{t("activationVideoPending")}</span></div>}
        <ol className="activation-help-steps"><li>{t("activationStep1")}</li><li>{t("activationStep2")}</li><li>{t("activationStep3")}</li></ol>
        {linkvertiseUrl ? <a className="activation-provider-link" href={linkvertiseUrl} target="_blank" rel="noopener noreferrer">{t("activationGoLinkvertise")} <ArrowUpRight size={19} /></a>
          : <p className="activation-provider-pending">{t("activationLinkPending")}</p>}
      </section> : <section className="runtime-gate-card activation-card">
        <div className="activation-card-heading"><div className="activation-key-mark"><KeyRound size={24} /></div><span className="eyebrow">{t("activationBeta")}</span></div>
        <h1>{busy ? t("activationChecking") : t("activationEnter")}</h1>
        <p>{t("activationLead")}</p>
        <form onSubmit={event => void activate(event)} className="activation-form">
          <label htmlFor="activation-key">{t("activationKeyLabel")}</label>
          <input id="activation-key" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder={t("activationKeyPlaceholder")} disabled={busy} />
          {error ? <p role="alert" className="activation-error">{error}</p> : null}
          {error && !key.trim() ? <button type="button" className="activation-retry" onClick={() => void verify()} disabled={busy}>{t("retryConnection")}</button> : null}
          <div className="runtime-gate-actions">
            <button type="submit" className="primary" disabled={busy || !key.trim()}>{busy ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />} {t("activationSubmit")}</button>
          </div>
        </form>
        <a className="activation-free-link" href="#obtener-clave">{t("activationGetFree")} <ArrowUpRight size={18} /></a>
      </section>}
    </main> : null}
    {stage === "validation" ? <footer className="ga-access-footer"><BackendStatus /><LanguageSwitch /></footer> : null}
    {stage !== "ready" ? <SplashScreen stage={stage} onIntroReady={completeIntro} onDockStart={startDock} onDocked={completeDock} /> : null}
  </>;
}
