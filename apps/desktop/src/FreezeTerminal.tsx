import { useEffect, useRef } from "react";
import { clock, eventText, FreezeArt, stats, STEP_KEYS, STEPS_OF } from "./FreezeConsole";
import { dismissFreezeJob, type FreezeJob } from "./freezeJobs";
import { formatBytes } from "./GenericDownloadProgress";
import { useI18n } from "./i18n";
import "./freeze-terminal.css";

const BAR_CELLS = 40;

/** A freeze or thaw shown in place, inside the game's expanded row of the Library Manager, as a terminal: a header
 *  strip with the share, bytes, speed and time left, the animated picture, the steps in brackets, a bar of cells, the
 *  file being worked on and the launcher's events as prompt lines. Once the work ends it stays with its result until
 *  it is closed. */
export default function FreezeTerminal({ job }: { job: FreezeJob }) {
  const { t } = useI18n();
  const progress = job.progress;
  const state = job.outcome ? (job.outcome.ok ? "done" : "failed") : "working";
  const percent = job.outcome?.ok ? 100 : progress?.percent ?? 0;
  const steps: readonly string[] = progress?.steps ?? STEPS_OF[job.mode];
  const current = steps.indexOf(progress?.step ?? steps[0]);
  const { speed, eta } = stats(progress);
  const filled = Math.round((percent / 100) * BAR_CELLS);
  const threads = progress?.events.find(event => event.kind === "threads")?.count;
  const log = useRef<HTMLOListElement>(null);
  const events = progress?.events ?? [];
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [events.length]);
  const title = t(job.mode === "thaw" ? "freezeConsoleThaw" : job.mode === "deep" ? "freezeConsoleDeep" : "freezeConsoleFreeze");
  return (
    <section className={`ga-term is-${state}${job.mode === "thaw" ? " is-thaw" : ""}${job.mode === "deep" ? " is-deep" : ""}`} aria-label={t("freezeConsoleLabel")}>
      <header className="ga-term-head">
        <span className="ga-term-tag">{title}</span>
        {threads ? <span className="ga-term-meta">{t("freezeEvThreads", { count: String(threads) })}</span> : null}
        <span className="ga-term-meta">{progress?.total_bytes ? `${formatBytes(progress.done_bytes)} / ${formatBytes(progress.total_bytes)}` : " "}</span>
        {state === "working" && speed > 0 ? <span className="ga-term-meta">{t("freezeSpeed", { speed: formatBytes(speed) })}{eta ? ` · ${t("freezeEta", { time: clock(eta) })}` : ""}</span> : null}
        <strong className="ga-term-percent">{percent.toFixed(1)}<small>%</small></strong>
      </header>
      <div className="ga-term-body">
        <div className="ga-term-art"><FreezeArt mode={job.mode} percent={percent} state={state} /></div>
        <div className="ga-term-main">
          <ol className="ga-term-steps">
            {steps.map((step, index) => {
              const status = state === "done" || index < current ? "done" : index === current ? (state === "failed" ? "failed" : "active") : "pending";
              return <li key={step} className={`is-${status}`}>{t(STEP_KEYS[step] ?? "freezeStepCompress")}</li>;
            })}
          </ol>
          <div className="ga-term-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(percent)}>
            {Array.from({ length: BAR_CELLS }, (_, index) => <i key={index} className={index < filled ? "is-on" : index === filled && state === "working" ? "is-head" : undefined} />)}
          </div>
          <p className="ga-term-file" title={progress?.file || undefined}>{state === "working" ? progress?.file || " " : job.outcome?.detail}</p>
          <ol ref={log} className="ga-term-log" tabIndex={-1}>
            {events.map((event, index) => (
              <li key={index} className={`is-${event.kind}`}><time>{clock(event.at - (progress?.started_at ?? event.at))}</time><span>{eventText(event, job, t)}</span></li>
            ))}
            {state === "working" ? <li className="ga-term-cursor"><time>{clock((progress?.updated_at ?? 0) - (progress?.started_at ?? 0))}</time><span>▍</span></li> : null}
          </ol>
        </div>
      </div>
      {job.outcome ? <button type="button" className="ga-term-dismiss" onClick={() => dismissFreezeJob(job.appId)}>{t("freezeTermDismiss")}</button> : null}
    </section>
  );
}
