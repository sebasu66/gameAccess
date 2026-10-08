import VoxelLogo from "./VoxelLogo";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, KeyRound, Loader2 } from "lucide-react";
import SplashScreen from "./SplashScreen";
import GameCoverBackdrop from "./GameCoverBackdrop";
import BackendStatus from "./BackendStatus";
import LanguageSwitch from "./LanguageSwitch";
import { openingStage } from "./openingFlow";
import { ACTIVATION_INVALID_EVENT, checkActivation, clearActivationSession, readActivationSession, redeemActivation, ActivationRejectedError, ActivationConnectionError, lastActivationEnd } from "./activation";
import type { ActivationStatus, ActivationEnd } from "./activation";
import { useI18n } from "./i18n";
import { activationRetryDelay, waitForActivationConnection } from "./activationConnection";
import { boundedFetch } from "./settings";
import { loadPixelStyle } from "./pixelStylePreferences";
import { ACTIVATION_WARNING_MS, nextActivationTimerDelay } from "./activationLifetime";

const linkvertiseUrl = import.meta.env.VITE_LINKVERTISE_URL?.trim() || "";
const plusUrl = import.meta.env.VITE_PLUS_CHECKOUT_URL?.trim() || "";
const tutorialVideoUrl = import.meta.env.VITE_LINKVERTISE_HELP_VIDEO_URL?.trim() || "";

export default function ActivationGate({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [freePassUrl, setFreePassUrl] = useState(linkvertiseUrl);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(true);
  const [ended, setEnded] = useState<ActivationEnd | null>(null);
  const verification = useRef<AbortController | null>(null);
  const redeeming = useRef(false);
  const [notice, setNotice] = useState("");
  const [introReady, setIntroReady] = useState(false);
  const [verificationReady, setVerificationReady] = useState(false);
  const [docked, setDocked] = useState(false);
  const [dockStarted, setDockStarted] = useState(false);
  const [applicationStarted, setApplicationStarted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(() => window.location.hash === "#obtener-clave");

  const stage = openingStage({ introReady, verificationReady, approved: Boolean(status?.active), docked });
  const completeIntro = useCallback(() => setIntroReady(true), []);
  const startDock = useCallback(() => setDockStarted(true), []);
  const completeDock = useCallback(() => setDocked(true), []);
  useEffect(() => {
    if (!status?.active) { setDocked(false); setDockStarted(false); }
    else if (introReady) setApplicationStarted(true);
  }, [status?.active, introReady]);
  useEffect(() => {
    const replay = () => { setIntroReady(false); setDocked(false); setDockStarted(false); };
    window.addEventListener("gameaccess:replay-logo", replay);
    return () => window.removeEventListener("gameaccess:replay-logo", replay);
  }, []);

  const verify = useCallback(async () => {
    if (redeeming.current) return;
    verification.current?.abort();
    const controller = new AbortController();
    verification.current = controller;
    const { signal } = controller;
    setBusy(true);
    setConnecting(true);
    setError("");
    try {
      const token = await readActivationSession();
      while (!signal.aborted) {
        const connection = await waitForActivationConnection(signal, () => setConnecting(true));
        try {
          const result = token ? await checkActivation(token, signal, connection.url) : null;
          if (signal.aborted) return;
          void boundedFetch(fetch, signal)(`${connection.url}/activation/free/config`, { cache: "no-store" })
            .then(async response => response.ok ? await response.json() as { configured: boolean } : null)
            .then(offers => { if (!signal.aborted) setFreePassUrl(offers?.configured ? `${connection.url}/activation/free/start` : linkvertiseUrl); })
            .catch(() => { if (!signal.aborted) setFreePassUrl(linkvertiseUrl); });
          setStatus(result);
          if (result) setEnded(null);
          setConnecting(false);
          break;
        } catch (reason) {
          if (signal.aborted) return;
          if (reason instanceof ActivationRejectedError) {
            setStatus(null);
            setEnded(reason.end);
            setConnecting(false);
            await clearActivationSession();
            break;
          }
          setConnecting(true);
          await activationRetryDelay(signal);
        }
      }
    } catch (reason) {
      if (!signal.aborted) {
        setConnecting(false);
        setError(reason instanceof Error ? reason.message : t("activationVerifyFailed"));
      }
    } finally {
      if (!signal.aborted) { setBusy(false); setVerificationReady(true); }
    }
  }, [t]);

  useEffect(() => {
    void verify();
    return () => verification.current?.abort();
  }, [verify]);
  useEffect(() => {
    const syncHelpPage = () => setHelpOpen(window.location.hash === "#obtener-clave");
    window.addEventListener("hashchange", syncHelpPage);
    return () => window.removeEventListener("hashchange", syncHelpPage);
  }, []);
  useEffect(() => {
    const invalid = () => {
      verification.current?.abort();
      setConnecting(false);
      setStatus(null);
      setNotice("");
      setEnded(lastActivationEnd());
      setBusy(false);
      setVerificationReady(true);
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
      verification.current?.abort();
      setConnecting(false);
      setStatus(null);
      setNotice("");
      setEnded({ reason: "expired", expires_at: status.expires_at });
      setBusy(false);
      setVerificationReady(true);
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

  useEffect(() => {
    if (!helpOpen) return;
    const frame = requestAnimationFrame(() => document.getElementById("obtener-clave")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [helpOpen]);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim() || busy || connecting) return;
    let reconnect = false;
    redeeming.current = true;
    verification.current?.abort();
    setBusy(true);
    setError("");
    try {
      setStatus(await redeemActivation(key));
      setKey("");
      setEnded(null);
    } catch (reason) {
      if (reason instanceof ActivationConnectionError) { reconnect = true; setConnecting(true); }
      else setError(reason instanceof Error ? reason.message : t("activationKeyFailed"));
    } finally { redeeming.current = false; setBusy(false); setVerificationReady(true); if (reconnect) void verify(); }
  };

  return <>
    {status?.active && (introReady || applicationStarted) ? <div className={`ga-application-reveal${dockStarted ? " is-revealing" : ""}${stage === "ready" ? " is-ready" : ""}`} aria-hidden={stage !== "ready"} ref={node => { if (node) node.inert = stage !== "ready"; }}>
      <div className="ga-access-brand"><VoxelLogo /></div>
      {children}
      {notice ? <div className="toast" role="status" aria-live="assertive">{notice}</div> : null}
    </div> : null}
    {stage !== "ready" ? <div className={`ga-opening-background${dockStarted && stage === "docking" ? " is-docking" : ""}`} data-stage={stage}><GameCoverBackdrop /></div> : null}
    {stage === "validation" || stage === "holding" ? <main className="activation-gate ga-validation">
      <div className="ga-entry-layout">
        <div className="ga-entry-content">
          {ended ? <aside className="activation-ended" role="status">
            <KeyRound size={20} aria-hidden="true" />
            <div><strong>{ended.reason === "expired" ? t("activationTimeEndedTitle") : ended.reason === "revoked" ? t("activationRevokedTitle") : t("activationUnavailableTitle")}</strong>
              <p>{ended.reason === "expired" && ended.expires_at && Number.isFinite(Date.parse(ended.expires_at))
                ? t("activationExpiredAt", { date: new Date(ended.expires_at).toLocaleString(locale === "es" ? "es-AR" : "en-US", { dateStyle: "medium", timeStyle: "short" }) })
                : ended.reason === "revoked" && ended.revoked_at && Number.isFinite(Date.parse(ended.revoked_at))
                ? t("activationRevokedAt", { date: new Date(ended.revoked_at).toLocaleString(locale === "es" ? "es-AR" : "en-US", { dateStyle: "medium", timeStyle: "short" }) })
                : ended.reason === "expired" ? t("activationTimeEnded") : ended.reason === "revoked" ? t("activationRevokedBody") : t("activationUnavailableBody")}</p>
              <p>{t("activationAnotherKey")}</p>
            </div>
          </aside> : null}
          <section id="acceso" className="activation-card" aria-labelledby="activation-title">
            <div className="activation-card-heading"><span className="eyebrow">{t("activationBeta")}</span><KeyRound size={20} aria-hidden="true" /></div>
            <h1 id="activation-title">{t("activationEnter")}</h1>
            <p className="activation-lead">{t("activationLead")}</p>
            <form onSubmit={event => void activate(event)} className="activation-form">
              <label htmlFor="activation-key">{t("activationKeyLabel")}</label>
              <input id="activation-key" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false}
                placeholder={t("activationKeyPlaceholder")} disabled={busy && !connecting} aria-describedby={error ? "activation-error" : undefined} />
              {error ? <p id="activation-error" role="alert" className="activation-error">{error}</p> : null}
              {connecting ? <>
                <p className="activation-connection-note" role="status"><Loader2 className="spin" size={18} aria-hidden="true" /><span>{t("activationServerWaking")}</span></p>
                <button type="button" className="primary activation-action" onClick={() => void verify()}>{t("retryConnection")}</button>
              </> : <button type="submit" className="primary activation-action" disabled={busy || !key.trim()}>
                {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <KeyRound size={18} aria-hidden="true" />}
                {busy ? t("activationChecking") : t("activationSubmit")}
              </button>}
            </form>
          </section>
          <section className="activation-passes" aria-labelledby="activation-passes-title">
            <h2 id="activation-passes-title">{t("activationChoosePass")}</h2>
            <div className="activation-pass-grid">
              <article className="activation-pass">
                <div className="activation-pass-heading"><h3>BASE</h3><span>{t("activationBetaShort")}</span></div>
                <p className="activation-pass-price">{t("activationBasePrice")}</p>
                <p>{t("activationBaseAds")}</p>
                <ul>{(["activationOneClick", "activationBigScreen", "activationRegularDownload", "activationEnhancedSearch"] as const).map(item =>
                  <li key={item}><Check size={14} aria-hidden="true" />{t(item)}</li>)}</ul>
                <a className="activation-pass-link" href="#obtener-clave">{t("activationGetBase")} <ArrowUpRight size={16} /></a>
              </article>
              <article className="activation-pass activation-pass-plus">
                <div className="activation-pass-heading"><h3>PLUS</h3><span>{t("activationBetaPromo")}</span></div>
                <p className="activation-pass-price">{t("activationPlusPrice")}</p>
                <p>{t("activationPlusTrial")}</p>
                <ul>{(["activationEverythingBase", "activationParallelDownloads", "activationFastDownloads"] as const).map(item =>
                  <li key={item}><Check size={14} aria-hidden="true" />{t(item)}</li>)}</ul>
                {plusUrl ? <a className="activation-pass-link" href={plusUrl} target="_blank" rel="noopener noreferrer">{t("activationGetPlus")} <ArrowUpRight size={16} /></a>
                  : <span className="activation-pass-pending">{t("activationPlusPending")}</span>}
              </article>
            </div>
          </section>
          {helpOpen ? <section id="obtener-clave" className="activation-card activation-help" aria-labelledby="activation-help-title">
            <a className="activation-back" href="#acceso"><ArrowLeft size={16} /> {t("activationBack")}</a>
            <h2 id="activation-help-title">{t("activationHelpTitle")}</h2>
            <p>{t("activationHelpLead")}</p>
            {tutorialVideoUrl ? <video className="activation-help-video" controls playsInline src={tutorialVideoUrl} aria-label={t("activationHelpVideo")} /> : null}
            <ol className="activation-help-steps"><li>{t("activationStep1")}</li><li>{t("activationStep2")}</li><li>{t("activationStep3")}</li></ol>
            {freePassUrl && !connecting ? <a className="activation-provider-link" href={freePassUrl} target="_blank" rel="noopener noreferrer">{t("activationGoLinkvertise")} <ArrowUpRight size={19} /></a>
              : <p className="activation-provider-pending">{t("activationLinkPending")}</p>}
          </section> : null}
        </div>
        <div className="ga-entry-brand" aria-hidden="true">
          {loadPixelStyle().animate && !matchMedia("(prefers-reduced-motion: reduce)").matches
            ? <video src="/brand/logo-entry-loop.webm" poster="/brand/logo-entry-poster.png" autoPlay loop muted playsInline />
            : <img src="/brand/logo-entry-poster.png" alt="" />}
          <GameAccessWordmark />
        </div>
      </div>
    </main> : null}
    {stage === "validation" || stage === "holding" ? <footer className="ga-access-footer"><BackendStatus /><LanguageSwitch /></footer> : null}
    {stage !== "ready" ? <SplashScreen stage={stage} onIntroReady={completeIntro} onDockStart={startDock} onDocked={completeDock} /> : null}
  </>;
}

// Squared, chamfered lettering echoes the sculpture without another display font.
function GameAccessWordmark() {
  return <svg className="ga-entry-wordmark" viewBox="-1 -1 37 20" focusable="false" aria-hidden="true">
    <g transform="translate(0.65 0.65) scale(1)" fill="#000" opacity=".45"><path d="M2 0H7V2H2V7H5V5H4V3H7V9H2L0 7V2Z" transform="translate(0 0)" fillRule="evenodd" /><path d="M2 0H5L7 2V9H5V6H2V9H0V2ZM2 2V4H5V2Z" transform="translate(9 0)" fillRule="evenodd" /><path d="M0 9V0H2L3.5 3L5 0H7V9H5V3L3.5 6L2 3V9Z" transform="translate(18 0)" fillRule="evenodd" /><path d="M0 0H7V2H2V3.5H6V5.5H2V7H7V9H0Z" transform="translate(27 0)" fillRule="evenodd" /></g>
    <g transform="translate(0 0) scale(1)" fill="#e8e8e2"><path d="M2 0H7V2H2V7H5V5H4V3H7V9H2L0 7V2Z" transform="translate(0 0)" fillRule="evenodd" /><path d="M2 0H5L7 2V9H5V6H2V9H0V2ZM2 2V4H5V2Z" transform="translate(9 0)" fillRule="evenodd" /><path d="M0 9V0H2L3.5 3L5 0H7V9H5V3L3.5 6L2 3V9Z" transform="translate(18 0)" fillRule="evenodd" /><path d="M0 0H7V2H2V3.5H6V5.5H2V7H7V9H0Z" transform="translate(27 0)" fillRule="evenodd" /></g>
    <g transform="translate(0.65 12.65) scale(0.654)" fill="#000" opacity=".45"><path d="M2 0H5L7 2V9H5V6H2V9H0V2ZM2 2V4H5V2Z" transform="translate(0 0)" fillRule="evenodd" /><path d="M2 0H7V2H2V7H7V9H2L0 7V2Z" transform="translate(9 0)" fillRule="evenodd" /><path d="M2 0H7V2H2V7H7V9H2L0 7V2Z" transform="translate(18 0)" fillRule="evenodd" /><path d="M0 0H7V2H2V3.5H6V5.5H2V7H7V9H0Z" transform="translate(27 0)" fillRule="evenodd" /><path d="M2 0H7V2H2V3.5H5L7 5.5V7L5 9H0V7H5V5.5H2L0 3.5V2Z" transform="translate(36 0)" fillRule="evenodd" /><path d="M2 0H7V2H2V3.5H5L7 5.5V7L5 9H0V7H5V5.5H2L0 3.5V2Z" transform="translate(45 0)" fillRule="evenodd" /></g>
    <g transform="translate(0 12) scale(0.654)" fill="#ff6a00"><path d="M2 0H5L7 2V9H5V6H2V9H0V2ZM2 2V4H5V2Z" transform="translate(0 0)" fillRule="evenodd" /><path d="M2 0H7V2H2V7H7V9H2L0 7V2Z" transform="translate(9 0)" fillRule="evenodd" /><path d="M2 0H7V2H2V7H7V9H2L0 7V2Z" transform="translate(18 0)" fillRule="evenodd" /><path d="M0 0H7V2H2V3.5H6V5.5H2V7H7V9H0Z" transform="translate(27 0)" fillRule="evenodd" /><path d="M2 0H7V2H2V3.5H5L7 5.5V7L5 9H0V7H5V5.5H2L0 3.5V2Z" transform="translate(36 0)" fillRule="evenodd" /><path d="M2 0H7V2H2V3.5H5L7 5.5V7L5 9H0V7H5V5.5H2L0 3.5V2Z" transform="translate(45 0)" fillRule="evenodd" /></g>
  </svg>;
}
