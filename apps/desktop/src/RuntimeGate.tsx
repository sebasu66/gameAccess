import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Gamepad2, Loader2, RefreshCw } from "lucide-react";
import { getRuntimePrerequisites, hasTauriRuntime, type RuntimePrerequisites } from "./native";
import { useI18n } from "./i18n";

export default function RuntimeGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<RuntimePrerequisites | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(hasTauriRuntime());

  const check = useCallback(async () => {
    if (!hasTauriRuntime()) return;
    setChecking(true);
    setError(null);
    try {
      setStatus(await getRuntimePrerequisites());
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (!hasTauriRuntime()) return <>{children}</>;

  // Steam installation/account state is informative only. Game Access must be
  // able to start on a clean machine; provider credentials are resolved only
  // when a game operation actually needs them.
  if (status?.runtime_ok) return <>{children}</>;

  return (
    <main className="runtime-gate">
      <section className="runtime-gate-card">
        <div className="runtime-gate-brand"><Gamepad2 size={28} /><strong>gameAccess</strong></div>
        <span className="eyebrow">{t("runtimeEyebrow")}</span>
        <h1>{checking ? t("runtimeCheckingTitle") : error ? t("runtimeErrorTitle") : t("runtimePreparingTitle")}</h1>
        <p>{checking ? t("runtimeCheckingBody") : error ? t("runtimeErrorBody", { error }) : t("runtimeRequirements")}</p>
        <div className="runtime-check-list">
          <div className={`runtime-check ${checking ? "pending" : "ok"}`}>
            {checking ? <Loader2 className="spin" size={19} /> : <CheckCircle2 size={19} />}
            <span><strong>{t("runtimeEnvironment")}</strong><small>{checking ? t("checking") : t("runtimeTauriOk")}</small></span>
          </div>
        </div>
        <div className="runtime-gate-actions">
          <button className="primary" onClick={() => void check()} disabled={checking}>
            <RefreshCw size={18} className={checking ? "spin" : ""} /> {t("checkAgain")}
          </button>
        </div>
      </section>
    </main>
  );
}
