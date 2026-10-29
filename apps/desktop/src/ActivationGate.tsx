import { reportPlus, reportPlusUnreachable } from "./kidMode";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import SplashScreen from "./SplashScreen";
import { openingStage } from "./openingFlow";
import { ACTIVATION_INVALID_EVENT, checkActivation, clearActivationSession, readActivationSession, redeemActivation, ActivationRejectedError, ActivationConnectionError, lastActivationEnd } from "./activation";
import type { ActivationStatus, ActivationEnd } from "./activation";
import GameCoverBackdrop from "./GameCoverBackdrop";
import { useI18n } from "./i18n";
import { activationRetryDelay, waitForActivationConnection } from "./activationConnection";
import { devAutoLoginKey } from "./devAutoLogin";
import { ACTIVATION_WARNING_MS, nextActivationTimerDelay } from "./activationLifetime";
import { PREMIUM_ACTIVATED_EVENT } from "./premiumContent";

/**
 * Opens the app for everyone: nobody needs a key to get in (free mode).
 *
 * A saved premium key is still checked in the background. If it is valid the
 * app upgrades to premium; if it has ended the person keeps using the free
 * mode and gets a short notice. Keys are entered from the "Activar premium"
 * button in the footer (see PremiumEntry).
 */
export default function ActivationGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [connecting, setConnecting] = useState(true);
  const [ended, setEnded] = useState<ActivationEnd | null>(null);
  const verification = useRef<AbortController | null>(null);
  const redeeming = useRef(false);
  const [notice, setNotice] = useState("");
  const [introReady, setIntroReady] = useState(false);
  const [verificationReady, setVerificationReady] = useState(false);
  const [docked, setDocked] = useState(false);
  const [dockStarted, setDockStarted] = useState(false);
  const [logoLanded, setLogoLanded] = useState(false);

  // A saved key that cannot be checked yet (slow or unreachable server) must not hold the splash:
  // after a moment the app opens in free mode and upgrades if the check succeeds later.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!introReady || verificationReady) { setWaited(false); return; }
    const timer = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(timer);
  }, [introReady, verificationReady]);
  const stage = openingStage({ introReady, verificationReady: verificationReady || waited, approved: true, docked });
  const completeIntro = useCallback(() => setIntroReady(true), []);
  const startDock = useCallback(() => setDockStarted(true), []);
  const completeDock = useCallback(() => { setLogoLanded(true); setDocked(true); }, []);
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
    try {
      const token = await readActivationSession();
      // No saved key: free mode, nothing to check and no server needed.
      if (!token) {
        if (!signal.aborted) { setStatus(null); setConnecting(false); }
        return;
      }
      while (!signal.aborted) {
        const connection = await waitForActivationConnection(signal, () => setConnecting(true));
        try {
          const result = await checkActivation(token, signal, connection.url);
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
            setNotice(endNotice(reason.end, t));
            setConnecting(false);
            await clearActivationSession();
            break;
          }
          setConnecting(true);
          await activationRetryDelay(signal);
        }
      }
    } catch {
      if (!signal.aborted) setConnecting(false);
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
      const end = lastActivationEnd();
      setEnded(end);
      setNotice(endNotice(end, t));
      setBusy(false);
      setVerificationReady(true);
      void clearActivationSession();
    };
    window.addEventListener(ACTIVATION_INVALID_EVENT, invalid);
    return () => window.removeEventListener(ACTIVATION_INVALID_EVENT, invalid);
  }, [t]);
  // The premium dialog redeemed a key: adopt the new session.
  useEffect(() => {
    const activated = () => { setNotice(""); void verify(); };
    window.addEventListener(PREMIUM_ACTIVATED_EVENT, activated);
    return () => window.removeEventListener(PREMIUM_ACTIVATED_EVENT, activated);
  }, [verify]);
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
      const end: ActivationEnd = { reason: keyRemaining <= initialRemaining ? "expired" : "unavailable", expires_at: status.expires_at };
      setEnded(end);
      setNotice(endNotice(end, t));
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

  // PLUS on or off, as far as the server said. An unreachable server ("unavailable") gets a grace period; no activation at all says nothing.
  useEffect(() => {
    if (!verificationReady) return;
    if (status?.active) reportPlus(status.access_tier === "plus");
    else if (ended && (ended.reason === "expired" || ended.reason === "revoked")) reportPlus(false);
    else if (ended?.reason === "unavailable") reportPlusUnreachable();
  }, [verificationReady, status, ended]);

  /**
   * Development convenience: sign in with the key in the local `.env`.
   *
   * Runs once, and only when no session is active, so it never replaces a valid
   * session and never retries a rejected key. With no `.env` nothing happens.
   */
  const autoLoginAttempted = useRef(false);
  useEffect(() => {
    if (autoLoginAttempted.current) return;
    if (!verificationReady || busy || connecting || status?.active) return;
    autoLoginAttempted.current = true;
    void (async () => {
      const devKey = await devAutoLoginKey(Boolean(status?.active));
      if (!devKey) return;
      let reconnect = false;
      redeeming.current = true;
      verification.current?.abort();
      setBusy(true);
      try {
        setStatus(await redeemActivation(devKey));
        setEnded(null);
      } catch (reason) {
        if (reason instanceof ActivationConnectionError) reconnect = true;
      } finally { redeeming.current = false; setBusy(false); if (reconnect) void verify(); }
    })();
  }, [verificationReady, busy, connecting, status?.active, verify]);

  return <>
    {(verificationReady || waited) ? <div className={`ga-application-reveal${dockStarted ? " is-revealing" : ""}${stage === "ready" ? " is-ready" : ""}`} aria-hidden={stage !== "ready"} ref={node => { if (node) node.inert = stage !== "ready"; }}>
      {children}
      {notice ? <div className="toast" role="status" aria-live="assertive">{notice}</div> : null}
    </div> : null}
    {!logoLanded ? <div className={`ga-opening-background${dockStarted ? " is-docking" : ""}`}><GameCoverBackdrop /></div> : null}
    {!logoLanded ? <SplashScreen stage={stage} onIntroReady={completeIntro} onDockStart={startDock} onDocked={completeDock} /> : null}
  </>;
}

/** Short notice shown when premium ends: the app simply continues in free mode. */
function endNotice(end: ActivationEnd, t: (key: "activationRevokedTitle" | "activationTimeEnded" | "activationUnavailableTitle") => string): string {
  return end.reason === "revoked" ? t("activationRevokedTitle")
    : end.reason === "expired" ? t("activationTimeEnded")
    : t("activationUnavailableTitle");
}
