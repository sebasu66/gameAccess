import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { useI18n } from "./i18n";
import type { DownloadProgressSnapshot, DownloadStepId } from "./downloadProvider";
import { downloadSteps, formatElapsed, stepsStarted, timelineSteps, type StepView } from "./downloadStepModel";

export const STEP_TITLES = { route: "dlStepRoute", probe: "dlStepProbe", server: "dlStepServer", download: "dlStepDownload", extract: "dlStepExtract", install: "dlStepInstall" } as const satisfies Record<DownloadStepId, string>;

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
 * The download's steps as one timeline (docs/TAREA-interfaz-nueva.md T12), each step once: the running one marked
 * (orange spinner, live detail, how long it has been running), done (green tick), pending (grey), not needed (faint)
 * and failed (red). While the download is prepared it shows the running step and the next one, and expands to the
 * whole sequence; once the download has begun only the steps still to come are listed (its progress has its own block).
 * Expanded, it also shows "Now" (the running step in words and how long it has been running) and `details` (sizes,
 * speed, route: the card keeps them folded so it stays quiet).
 */
export default function DownloadSteps({ snapshot, phaseLabel, details }: { snapshot: DownloadProgressSnapshot; phaseLabel?: string; details?: ReactNode }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const steps = downloadSteps(snapshot);
  const current = steps.find(step => step.state === "current" || step.state === "failed");
  const elapsed = useElapsed(current?.state === "current" ? current.startedAt : undefined);
  const started = stepsStarted(steps);
  const shown = timelineSteps(steps, expanded);
  const line = (step: StepView) => step.state === "skipped" ? step.text || t("dlStepSkipped") : step.text;
  if (!shown.length && !details) return null;
  return (
    <div className="ga-dl-steps">
      {expanded ? <div className={`ga-dl-now${current?.state === "failed" ? " is-failed" : ""}`}>
        <span className="ga-dl-eyebrow">{t("dlNow")}</span>
        <strong>{current ? t(STEP_TITLES[current.id]) : phaseLabel}</strong>
        <p>{current?.text || snapshot.statusText || phaseLabel}</p>
        {elapsed ? <span className="ga-dl-elapsed">{t("dlRunningFor", { time: elapsed })}</span> : null}
      </div> : null}
      <ol className="ga-dl-sequence" aria-label={t("dlStepsTitle")}>
        {shown.map(step => (
          <li key={step.id} className={`is-${step.state}`}>
            <span className="ga-dl-dot" aria-hidden="true">
              {step.state === "done" ? <Check size={11} strokeWidth={3} /> : step.state === "current" ? <Loader2 size={12} className="spin" /> : step.state === "failed" ? <X size={11} strokeWidth={3} /> : null}
            </span>
            <div>
              <b>{t(STEP_TITLES[step.id])}</b>
              {line(step) ? <span>{line(step)}</span> : null}
            </div>
            {step.state === "done" && step.ms ? <em>{formatElapsed(step.ms)}</em> : step.state === "current" && elapsed ? <em>{elapsed}</em> : null}
          </li>
        ))}
      </ol>
      {expanded ? details : null}
      {!started || details ? (
        <button type="button" className="ga-dl-steps-more" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}
          aria-label={expanded ? t("dlStepsFewer") : t("dlStepsAll", { count: steps.length })} title={expanded ? t("dlStepsFewer") : t("dlStepsAll", { count: steps.length })}>
          {expanded ? <ChevronUp size={18} strokeWidth={1.5} aria-hidden="true" /> : <ChevronDown size={18} strokeWidth={1.5} aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );
}
