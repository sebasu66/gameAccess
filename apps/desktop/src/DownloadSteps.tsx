import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { useI18n } from "./i18n";
import type { DownloadProgressSnapshot, DownloadStepId } from "./downloadProvider";
import { downloadSteps, formatElapsed, type StepView } from "./downloadStepModel";

const titles = { route: "dlStepRoute", probe: "dlStepProbe", server: "dlStepServer", download: "dlStepDownload", extract: "dlStepExtract", install: "dlStepInstall" } as const satisfies Record<DownloadStepId, string>;

/** Seconds since a step started, refreshed every second while it runs. */
function useElapsed(startedAt?: number): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt ? formatElapsed(now - startedAt) : null;
}

/**
 * What the active download is doing (docs/TAREA-interfaz-nueva.md T12): "Now" first — the current step, in words,
 * and how long it has been running — then the whole sequence: done (green tick, result, duration), running (orange
 * spinner, live detail), pending (grey), not needed (faint, dotted) and failed (red, with the error).
 */
export default function DownloadSteps({ snapshot, phaseLabel }: { snapshot: DownloadProgressSnapshot; phaseLabel: string }) {
  const { t } = useI18n();
  const steps = downloadSteps(snapshot);
  const current = steps.find(step => step.state === "current" || step.state === "failed");
  const elapsed = useElapsed(current?.state === "current" ? current.startedAt : undefined);
  const line = (step: StepView) => step.state === "skipped" ? step.text || t("dlStepSkipped") : step.text;
  return (
    <div className="ga-dl-steps">
      <div className={`ga-dl-now${current?.state === "failed" ? " is-failed" : ""}`}>
        <span className="ga-dl-eyebrow">{t("dlNow")}</span>
        <strong>{current ? t(titles[current.id]) : phaseLabel}</strong>
        <p>{current?.text || snapshot.statusText || phaseLabel}</p>
        {elapsed ? <span className="ga-dl-elapsed">{t("dlRunningFor", { time: elapsed })}</span> : null}
      </div>
      <ol className="ga-dl-sequence" aria-label={t("dlStepsTitle")}>
        {steps.map(step => (
          <li key={step.id} className={`is-${step.state}`}>
            <span className="ga-dl-dot" aria-hidden="true">
              {step.state === "done" ? <Check size={11} strokeWidth={3} /> : step.state === "current" ? <Loader2 size={12} className="spin" /> : step.state === "failed" ? <X size={11} strokeWidth={3} /> : null}
            </span>
            <div>
              <b>{t(titles[step.id])}</b>
              {line(step) ? <span>{line(step)}</span> : null}
            </div>
            {step.state === "done" && step.ms ? <em>{formatElapsed(step.ms)}</em> : step.state === "current" && elapsed ? <em>{elapsed}</em> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
