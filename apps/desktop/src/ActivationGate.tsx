import VoxelLogo from "./VoxelLogo";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight, KeyRound, Loader2 } from "lucide-react";
import SplashScreen from "./SplashScreen";
import BackendStatus from "./BackendStatus";
import { openingStage } from "./openingFlow";
import { ACTIVATION_INVALID_EVENT, checkActivation, clearActivationSession, readActivationSession, redeemActivation, ActivationRejectedError, ActivationConnectionError, lastActivationEnd } from "./activation";
import type { ActivationStatus, ActivationEnd } from "./activation";
import GameCoverBackdrop from "./GameCoverBackdrop";
import { useI18n } from "./i18n";
import { activationRetryDelay, waitForActivationConnection } from "./activationConnection";
import { devAutoLoginKey } from "./devAutoLogin";
import { ACTIVATION_WARNING_MS, nextActivationTimerDelay } from "./activationLifetime";

/** Where people go to get a key: the website lists every way to do it. */
const websiteUrl = import.meta.env.VITE_GAMEACCESS_WEBSITE_URL?.trim() || "https://gameaccess.app";

export default function ActivationGate({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<ActivationStatus | null>(null);
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
  /** The logo has finished raining up to the header: from here on only the app (and the key panel, if needed) is on screen. */
  const [logoLanded, setLogoLanded] = useState(false);

  const checkedStage = openingStage({ introReady, verificationReady, approved: Boolean(status?.active), docked });
  // A slow or unreachable server must not leave only the big logo on screen: after a moment the panel explains what is happening.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (checkedStage !== "holding") { setWaited(false); return; }
    const timer = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(timer);
  }, [checkedStage]);
  const stage = checkedStage === "holding" && waited ? "validation" : checkedStage;
  /** The access panel shows over the real grid once the logo has landed, and fades out when access is granted. */
  const entryVisible = logoLanded && !status?.active && stage === "validation";
  const [entryLeaving, setEntryLeaving] = useState(false);
  const entryWasVisible = useRef(false);
  useEffect(() => {
    if (entryVisible) { entryWasVisible.current = true; setEntryLeaving(false); return; }
    if (!entryWasVisible.current) return;
    entryWasVisible.current = false;
    setEntryLeaving(true);
    const timer = window.setTimeout(() => setEntryLeaving(false), 450);
    return () => window.clearTimeout(timer);
  }, [entryVisible]);
  const entryShown = entryVisible || entryLeaving;
  const completeIntro = useCallback(() => setIntroReady(true), []);
  const startDock = useCallback(() => setDockStarted(true), []);
  const completeDock = useCallback(() => { setLogoLanded(true); setDocked(true); }, []);
  useEffect(() => {
    if (status?.active && introReady) setApplicationStarted(true);
  }, [status?.active, introReady]);
  useEffect(() => {
    const replay = () => { setIntroReady(false); setDocked(false); setDockStarted(false); setLogoLanded(false); };
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
    if (!status?.active) return;
    const timer = window.setInterval(() => void verify(), 60000);
    return () => window.clearInterval(timer);
  }, [status?.active, verify]);
  useEffect(() => {
    if (!status) return;
    setNotice("");
    const keyRemaining = Date.parse(status.expires_at) - Date.parse(status.server_time);
    const leaseRemaining = status.lease_expires_at ? Date.parse(status.lease_expires_at) - Date.parse(status.server_time) : 300000;
    const initialRemaining = Math.min(keyRemaining, leaseRemaining, 300000);
    const observedAt = Date.now();
    const observedMonotonic = performance.now();
    let timer: number | undefined;
    let cancelled = false;

    const expire = () => {
      verification.current?.abort();
      setConnecting(false);
      setStatus(null);
      setNotice("");
      setEnded({ reason: keyRemaining <= initialRemaining ? "expired" : "unavailable", expires_at: status.expires_at });
      setBusy(false);
      setVerificationReady(true);
      void clearActivationSession();
    };

    const tick = () => {
      if (cancelled) return;
      const remaining = initialRemaining - Math.max(performance.now() - observedMonotonic, Date.now() - observedAt);
      if (!Number.isFinite(remaining) || remaining <= 0) {
        expire();
        return;
      }
      const keyStillRemaining = keyRemaining - Math.max(performance.now() - observedMonotonic, Date.now() - observedAt);
      if (keyStillRemaining <= ACTIVATION_WARNING_MS) setNotice(t("activationExpiringSoon"));
      timer = window.setTimeout(tick, nextActivationTimerDelay(remaining));
    };

    tick();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [status, t]);

  /**
   * Send a key to the server and adopt the result.
   *
   * Shared by the form and by the development auto-login, so both go through the
   * same validation, error handling and connection recovery.
   */
  const redeemKey = useCallback(async (submitted: string) => {
    if (!submitted.trim() || busy || connecting) return;
    let reconnect = false;
    redeeming.current = true;
    verification.current?.abort();
    setBusy(true);
    setError("");
    try {
      setStatus(await redeemActivation(submitted));
      setKey("");
      setEnded(null);
    } catch (reason) {
      if (reason instanceof ActivationConnectionError) { reconnect = true; setConnecting(true); }
      else setError(reason instanceof Error ? reason.message : t("activationKeyFailed"));
    } finally { redeeming.current = false; setBusy(false); setVerificationReady(true); if (reconnect) void verify(); }
  }, [busy, connecting, t, verify]);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    await redeemKey(key);
  };

  /**
   * Development convenience: sign in with the key in the local `.env`.
   *
   * Runs once, and only when no session is active, so it never replaces a valid
   * session and never retries a rejected key. With no `.env` the gate behaves
   * exactly as before.
   */
  const autoLoginAttempted = useRef(false);
  useEffect(() => {
    if (autoLoginAttempted.current) return;
    if (!verificationReady || busy || connecting || status?.active) return;
    autoLoginAttempted.current = true;
    void (async () => {
      const devKey = await devAutoLoginKey(Boolean(status?.active));
      if (devKey) await redeemKey(devKey);
    })();
  }, [verificationReady, busy, connecting, status?.active, redeemKey]);

  return <>
    {(verificationReady || (status?.active && (introReady || applicationStarted))) ? <div className={`ga-application-reveal${!status?.active ? " is-entry-preview" : ""}${dockStarted ? " is-revealing" : ""}${stage === "ready" ? " is-ready" : ""}`} aria-hidden={stage !== "ready"} ref={node => { if (node) node.inert = stage !== "ready"; }}>
      {status?.active && (introReady || applicationStarted) ? <div className="ga-access-brand"><VoxelLogo /></div> : null}
      {children}
      {notice ? <div className="toast" role="status" aria-live="assertive">{notice}</div> : null}
    </div> : null}
    {!logoLanded ? <div className={`ga-opening-background${dockStarted ? " is-docking" : ""}`}><GameCoverBackdrop /></div> : null}
    {entryShown ? <div className={`ga-opening-background${entryLeaving ? " is-docking" : ""}`} data-stage="validation"><div className="ga-entry-scrim" aria-hidden="true" /></div> : null}
    {entryShown ? <main className={`activation-gate ga-validation${entryLeaving ? " is-leaving" : ""}`}>
      <div className="ga-entry-layout">
        <div className="ga-entry-content">
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
        <p className="ga-entry-getkey">{t("activationNeedKey")} <a href={websiteUrl} target="_blank" rel="noopener noreferrer">{t("activationGetKeyHere")} <ArrowUpRight size={18} aria-hidden="true" /></a></p>
      </div>
    </main> : null}
    {entryShown ? <footer className={`ga-access-footer${entryLeaving ? " is-leaving" : ""}`}><BackendStatus /></footer> : null}
    {!logoLanded ? <SplashScreen stage={stage} onIntroReady={completeIntro} onDockStart={startDock} onDocked={completeDock} /> : null}
  </>;
}
