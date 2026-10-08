import VoxelLogo from "./VoxelLogo";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, CheckCircle2, ChevronRight, Clock3, Crown, Download, Gamepad2, Gauge, Globe2, KeyRound, Layers3, Loader2, LockKeyhole, Monitor, Play, Search } from "lucide-react";
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
    {(verificationReady || (status?.active && (introReady || applicationStarted))) ? <div className={`ga-application-reveal${!status?.active ? " is-entry-preview" : ""}${dockStarted ? " is-revealing" : ""}${stage === "ready" ? " is-ready" : ""}`} aria-hidden={stage !== "ready"} ref={node => { if (node) node.inert = stage !== "ready"; }}>
      {status?.active && (introReady || applicationStarted) ? <div className="ga-access-brand"><VoxelLogo /></div> : null}
      {children}
      {notice ? <div className="toast" role="status" aria-live="assertive">{notice}</div> : null}
    </div> : null}
    {stage !== "ready" ? <div className={`ga-opening-background${dockStarted && stage === "docking" ? " is-docking" : ""}`} data-stage={stage}>
      {stage === "validation" || stage === "holding" ? <div className="ga-entry-scrim" aria-hidden="true" /> : <GameCoverBackdrop />}
    </div> : null}
    {stage === "validation" || stage === "holding" ? <main className="activation-gate ga-validation">
      <div className="ga-entry-layout">
        <div className="ga-entry-content">
          <div className="ga-entry-brand" aria-hidden="true">
            {loadPixelStyle().animate && !matchMedia("(prefers-reduced-motion: reduce)").matches
              ? <video src="/brand/logo-entry-loop.webm" poster="/brand/logo-entry-poster.png" autoPlay loop muted playsInline />
              : <img src="/brand/logo-entry-poster.png" alt="" />}
            <GameAccessWordmark />
            <p className="ga-entry-tagline">{t("activationBrandTagline")}</p>
          </div>
          {ended ? <aside className="activation-ended" role="status">
            <KeyRound size={24} aria-hidden="true" />
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
            <div className="activation-card-heading"><span className="eyebrow">{t("activationBeta")}</span><KeyRound size={21} aria-hidden="true" /></div>
            <h1 id="activation-title">{t("activationEnter")}</h1>
            <p className="activation-lead">{t("activationLead")}</p>
            <form onSubmit={event => void activate(event)} className="activation-form">
              <label htmlFor="activation-key">{t("activationKeyLabel")}</label>
              <div className="activation-key-control"><KeyRound size={23} aria-hidden="true" />
                <input id="activation-key" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false}
                  placeholder={t("activationKeyPlaceholder")} disabled={busy && !connecting} aria-describedby={error ? "activation-error" : undefined} />
              </div>
              {error ? <p id="activation-error" role="alert" className="activation-error">{error}</p> : null}
              {connecting ? <>
                <p className="activation-connection-note" role="status"><Loader2 className="spin" size={20} aria-hidden="true" /><span>{t("activationServerWaking")}</span></p>
                <button type="button" className="primary activation-action" onClick={() => void verify()}>{t("retryConnection")}</button>
              </> : <button type="submit" className="primary activation-action" disabled={busy || !key.trim()}>
                {busy ? <Loader2 className="spin" size={21} aria-hidden="true" /> : null}
                {busy ? t("activationChecking") : t("activationSubmit")}
                {!busy ? <ChevronRight size={22} aria-hidden="true" /> : null}
              </button>}
            </form>
          </section>
        </div>
        <section className="activation-passes" aria-labelledby="activation-passes-title">
          <div className="activation-passes-intro">
            <h2 id="activation-passes-title">{t("activationChoosePass")}</h2>
            <p>{t("activationPassLead")}</p>
          </div>
          <div className="activation-pass-grid">
            <article className="activation-pass">
              <img className="activation-access-card-art" src="/brand/access-ticket-base.webp" alt="" />
              <div className="activation-pass-copy">
                <div className="activation-pass-heading"><div><div className="activation-pass-title"><h3>BASE</h3><Gamepad2 size={34} aria-hidden="true" /></div><span>{t("activationBetaShort")}</span></div></div>
                <div className="activation-pass-intro"><p className="activation-pass-price">{t("activationBasePrice")}</p><p>{t("activationBaseAds")}</p></div>
                <ul>
                  <li><Download aria-hidden="true" /><span>{t("activationOneClick")}</span></li>
                  <li><Monitor aria-hidden="true" /><span>{t("activationBigScreen")}</span></li>
                  <li><Clock3 aria-hidden="true" /><span>{t("activationRegularDownload")}</span></li>
                  <li><Search aria-hidden="true" /><span>{t("activationEnhancedSearch")}</span></li>
                </ul>
                <div className="activation-pass-actions"><a className="activation-pass-link" href="#obtener-clave"><Play size={20} aria-hidden="true" />{t("activationGetBase")}</a></div>
              </div>
            </article>
            <article className="activation-pass activation-pass-plus">
              <img className="activation-access-card-art" src="/brand/access-ticket-plus.webp" alt="" />
              <div className="activation-pass-copy">
                <div className="activation-pass-heading"><div><div className="activation-pass-title"><h3>PLUS</h3><Crown size={34} aria-hidden="true" /></div><span>{t("activationBetaPromo")}</span></div></div>
                <div className="activation-pass-intro"><p className="activation-pass-price">{t("activationPlusPrice")}</p><p className="activation-pass-trial">{t("activationPlusTrial")}</p></div>
                <ul>
                  <li><CheckCircle2 aria-hidden="true" /><span>{t("activationEverythingBase")}</span></li>
                  <li><Layers3 aria-hidden="true" /><span>{t("activationParallelDownloads")}</span></li>
                  <li><Gauge aria-hidden="true" /><span>{t("activationFastDownloads")}</span></li>
                </ul>
                <div className="activation-pass-actions">{plusUrl ? <a className="activation-pass-link" href={plusUrl} target="_blank" rel="noopener noreferrer">{t("activationGetPlus")} <ArrowUpRight size={20} aria-hidden="true" /></a>
                  : <span className="activation-pass-pending"><LockKeyhole size={20} aria-hidden="true" />{t("activationPlusPending")}</span>}</div>
              </div>
            </article>
          </div>
        </section>
        {helpOpen ? <section id="obtener-clave" className="activation-card activation-help" aria-labelledby="activation-help-title">
          <a className="activation-back" href="#acceso"><ArrowLeft size={20} aria-hidden="true" /> {t("activationBack")}</a>
          <h2 id="activation-help-title">{t("activationHelpTitle")}</h2>
          <p>{t("activationHelpLead")}</p>
          {tutorialVideoUrl ? <video className="activation-help-video" controls playsInline src={tutorialVideoUrl} aria-label={t("activationHelpVideo")} /> : null}
          <ol className="activation-help-steps"><li>{t("activationStep1")}</li><li>{t("activationStep2")}</li><li>{t("activationStep3")}</li></ol>
          {freePassUrl && !connecting ? <a className="activation-provider-link" href={freePassUrl} target="_blank" rel="noopener noreferrer">{t("activationGoLinkvertise")} <ArrowUpRight size={21} aria-hidden="true" /></a>
            : <p className="activation-provider-pending">{t("activationLinkPending")}</p>}
        </section> : null}
      </div>
    </main> : null}
    {stage === "validation" || stage === "holding" ? <footer className="ga-access-footer"><BackendStatus /><div className="ga-entry-languages"><Globe2 size={23} aria-hidden="true" /><LanguageSwitch /></div></footer> : null}
    {stage !== "ready" ? <SplashScreen stage={stage} onIntroReady={completeIntro} onDockStart={startDock} onDocked={completeDock} /> : null}
  </>;
}

// Typography stays live so the wordmark scales sharply alongside the real G/A film.
function GameAccessWordmark() {
  return <div className="ga-entry-wordmark"><span>Game</span><span>Access</span></div>;
}
