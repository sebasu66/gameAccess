import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Gamepad2, Loader2, RefreshCw } from "lucide-react";
import { getRuntimePrerequisites, hasTauriRuntime, openSteamClient, type RuntimePrerequisites } from "./native";
import { useI18n } from "./i18n";

export default function RuntimeGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
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
        <span className="eyebrow">{t("runtimeEyebrow")}</span>
        <h1>{checking ? t("runtimeCheckingTitle") : steamMissing ? t("runtimeSteamMissingTitle") : accountsMissing ? t("runtimeAccountMissingTitle") : error ? t("runtimeErrorTitle") : t("runtimePreparingTitle")}</h1>
        <p>{checking ? t("runtimeCheckingBody") : steamMissing ? t("runtimeSteamMissingBody") : accountsMissing ? t("runtimeAccountMissingBody") : error ? t("runtimeErrorBody", { error }) : t("runtimeRequirements")}</p>
        <div className="runtime-check-list">
          <div className="runtime-check ok"><CheckCircle2 size={19} /><span><strong>{t("runtimeEnvironment")}</strong><small>{t("runtimeTauriOk")}</small></span></div>
          <div className={`runtime-check ${status?.steam_installed ? "ok" : checking ? "pending" : "bad"}`}>{checking ? <Loader2 className="spin" size={19} /> : status?.steam_installed ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}<span><strong>Steam</strong><small>{status?.steam_installed ? status.steam_path ?? t("detected") : t("notDetected")}</small></span></div>
          <div className={`runtime-check ${(status?.remembered_accounts ?? 0) > 0 ? "ok" : checking ? "pending" : "bad"}`}>{checking ? <Loader2 className="spin" size={19} /> : (status?.remembered_accounts ?? 0) > 0 ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}<span><strong>{t("rememberedAccounts")}</strong><small>{status ? t("accountsDetected", { count: status.remembered_accounts, suffix: status.remembered_accounts === 1 ? "" : "s" }) : t("checking")}</small></span></div>
        </div>
        <div className="runtime-gate-actions">
          {accountsMissing ? <button onClick={() => void openSteamClient().catch((err) => setError(String(err)))}><Gamepad2 size={18} /> {t("openSteam")}</button> : null}
          <button className="primary" onClick={() => void check()} disabled={checking}><RefreshCw size={18} className={checking ? "spin" : ""} /> {t("checkAgain")}</button>
        </div>
      </section>
    </main>
  );
}
