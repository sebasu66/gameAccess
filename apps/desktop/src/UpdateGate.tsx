import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Download, Gamepad2, Loader2, RefreshCw } from "lucide-react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { hasTauriRuntime } from "./native";
import { useI18n } from "./i18n";
import { narrate } from "./narrationLog";
import { runUpdate, updatesEnabled, type UpdatePhase } from "./appUpdate";

const deps = {
  check: () => check(),
  relaunch: () => relaunch(),
  log: (message: string, level: "INFO" | "WARN" = "INFO") => void narrate(message, { area: "UPDATE", level }),
};

/**
 * Mandatory self-update. The app keeps starting while the check runs (it takes a second); when a newer version
 * exists this dialog covers everything until it is installed and the app restarts.
 */
export default function UpdateGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [skipped, setSkipped] = useState(false);
  const enabled = updatesEnabled(import.meta.env.VITE_GAMEACCESS_CHANNEL, hasTauriRuntime());

  const start = useCallback(() => {
    if (enabled) void runUpdate(deps, setPhase);
  }, [enabled]);

  useEffect(start, [start]);

  const blocking = phase.kind !== "idle" && !skipped;
  const percent = phase.kind === "downloading" && phase.total > 0 ? Math.min(100, (phase.done / phase.total) * 100) : null;
  return (
    <>
      {children}
      {blocking && (
        <main className="runtime-gate update-gate" role="dialog" aria-modal="true" aria-live="polite">
          <section className="runtime-gate-card">
            <div className="runtime-gate-brand"><Gamepad2 size={28} /><strong>gameAccess</strong></div>
            <span className="eyebrow">{t("updateEyebrow")}</span>
            <h1>{phase.kind === "failed" ? t("updateFailedTitle") : t("updateTitle", { version: phase.version })}</h1>
            <p>{phase.kind === "failed" ? t("updateFailedBody", { error: phase.error }) : phase.kind === "installing" ? t("updateInstallingBody") : t("updateDownloadingBody")}</p>
            {phase.kind !== "failed" && (
              <div className="update-progress" aria-label={t("updateTitle", { version: phase.version })}>
                <div className={`update-progress-bar${percent === null ? " indeterminate" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} />
                <small>
                  {phase.kind === "installing" ? <><Loader2 className="spin" size={14} /> {t("updateInstalling")}</>
                    : <><Download size={14} /> {percent === null ? t("updatePreparing") : `${percent.toFixed(0)}% · ${(phase.done / 1048576).toFixed(0)} / ${(phase.total / 1048576).toFixed(0)} MB`}</>}
                </small>
              </div>
            )}
            {phase.kind === "failed" && (
              <div className="runtime-gate-actions">
                <button onClick={() => setSkipped(true)}>{t("updateContinue")}</button>
                <button className="primary" onClick={start}><RefreshCw size={18} /> {t("updateRetry")}</button>
              </div>
            )}
          </section>
        </main>
      )}
    </>
  );
}
