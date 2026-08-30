import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Gamepad2, Loader2, RefreshCw } from "lucide-react";
import { getRuntimePrerequisites, hasTauriRuntime, openSteamClient, type RuntimePrerequisites } from "./native";

export default function RuntimeGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RuntimePrerequisites | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(hasTauriRuntime());
  const check = useCallback(async () => {
    if (!hasTauriRuntime()) return;
    setChecking(true); setError(null);
    try { setStatus(await getRuntimePrerequisites()); }
    catch (err) { setStatus(null); setError(err instanceof Error ? err.message : String(err)); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(); }, [check]);
  if (!hasTauriRuntime()) return <>{children}</>;
  const ready = status?.runtime_ok && status.steam_installed && status.remembered_accounts > 0;
  if (ready) return <>{children}</>;
  const steamMissing = Boolean(status && !status.steam_installed);
  const accountsMissing = Boolean(status?.steam_installed && status.remembered_accounts === 0);
  return (
    <main className="runtime-gate">
      <section className="runtime-gate-card">
        <div className="runtime-gate-brand"><Gamepad2 size={28} /><strong>gameAccess</strong></div>
        <span className="eyebrow">COMPROBACIÓN DE ENTORNO</span>
        <h1>{checking ? "Verificando GameAccess…" : steamMissing ? "Steam no está disponible" : accountsMissing ? "Falta una cuenta recordada en Steam" : error ? "No pudimos verificar el entorno" : "Preparando GameAccess…"}</h1>
        <p>{checking ? "La interfaz está funcionando. Estamos comprobando el estado local antes de abrir tu biblioteca." : steamMissing ? "Steam es necesario para usar GameAccess. Si lo desinstalaste después de instalar GameAccess, reinstalalo y volvé a comprobar." : accountsMissing ? "Abrí Steam, iniciá sesión en al menos una cuenta y dejala recordada en este equipo. Después volvé a comprobar." : error ? `El runtime respondió con un error: ${error}` : "Comprobando requisitos…"}</p>
        <div className="runtime-check-list">
          <div className="runtime-check ok"><CheckCircle2 size={19} /><span><strong>Runtime GameAccess</strong><small>Tauri inició correctamente.</small></span></div>
          <div className={`runtime-check ${status?.steam_installed ? "ok" : checking ? "pending" : "bad"}`}>{checking ? <Loader2 className="spin" size={19} /> : status?.steam_installed ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}<span><strong>Steam</strong><small>{status?.steam_installed ? status.steam_path ?? "Detectado" : "No detectado"}</small></span></div>
          <div className={`runtime-check ${(status?.remembered_accounts ?? 0) > 0 ? "ok" : checking ? "pending" : "bad"}`}>{checking ? <Loader2 className="spin" size={19} /> : (status?.remembered_accounts ?? 0) > 0 ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}<span><strong>Cuentas Steam recordadas</strong><small>{status ? `${status.remembered_accounts} detectada${status.remembered_accounts === 1 ? "" : "s"}` : "Comprobando…"}</small></span></div>
        </div>
        <div className="runtime-gate-actions">
          {accountsMissing ? <button onClick={() => void openSteamClient().catch((err) => setError(String(err)))}><Gamepad2 size={18} /> Abrir Steam</button> : null}
          <button className="primary" onClick={() => void check()} disabled={checking}><RefreshCw size={18} className={checking ? "spin" : ""} /> Volver a comprobar</button>
        </div>
      </section>
    </main>
  );
}
