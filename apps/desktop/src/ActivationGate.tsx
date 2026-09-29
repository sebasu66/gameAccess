import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import SplashScreen from "./SplashScreen";
import { ACTIVATION_INVALID_EVENT, checkActivation, clearActivationSession, readActivationSession, redeemActivation } from "./activation";
import type { ActivationStatus } from "./activation";

export default function ActivationGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [splashComplete, setSplashComplete] = useState(false);

  const completeSplash = useCallback(() => setSplashComplete(true), []);

  const verify = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const token = await readActivationSession();
      if (!token) { setStatus(null); return; }
      setStatus(await checkActivation(token));
    } catch (reason) {
      setStatus(null);
      setError(reason instanceof Error ? reason.message : "No se pudo verificar la activación.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void verify(); }, [verify]);
  useEffect(() => {
    const invalid = () => {
      setStatus(null);
      setError("La activación venció o fue revocada. Volvé a verificar o ingresá otra clave.");
      void clearActivationSession();
    };
    window.addEventListener(ACTIVATION_INVALID_EVENT, invalid);
    return () => window.removeEventListener(ACTIVATION_INVALID_EVENT, invalid);
  }, []);
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
    const remaining = Date.parse(status.expires_at) - Date.parse(status.server_time);
    const timeout = window.setTimeout(() => void verify(), Math.max(1000, Math.min(remaining, 24 * 60 * 60 * 1000)));
    return () => window.clearTimeout(timeout);
  }, [status, verify]);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await redeemActivation(key));
      setKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo activar esta instalación.");
    } finally { setBusy(false); }
  };

  return <>
    {status?.active ? children : <main className="runtime-gate activation-gate">
      <section className="runtime-gate-card activation-card">
        <div className="activation-card-heading">
          <div className="activation-key-mark"><KeyRound size={24} /></div>
          <span className="eyebrow">ACCESO BETA</span>
        </div>
        <h1>{busy ? "Verificando acceso…" : "Entrá a Game Access"}</h1>
        <p>Ingresá tu clave para habilitar esta instalación.</p>
        <form onSubmit={event => void activate(event)} className="activation-form">
          <label htmlFor="activation-key">Clave de acceso</label>
          <input id="activation-key" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Pegá tu clave acá" disabled={busy} />
          {error ? <p role="alert" className="activation-error">{error}</p> : null}
          <div className="runtime-gate-actions">
            <button type="button" onClick={() => void verify()} disabled={busy}><RefreshCw size={18} /> Verificar</button>
            <button type="submit" className="primary" disabled={busy || !key.trim()}>{busy ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />} Activar acceso</button>
          </div>
        </form>
        <div className="activation-card-footer"><span className="activation-status-dot" /> La clave se valida de forma segura con el servidor</div>
      </section>
    </main>}
    {(!status?.active || !splashComplete) ? <SplashScreen onComplete={completeSplash} /> : null}
  </>;
}
