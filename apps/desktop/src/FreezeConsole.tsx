import { useEffect, useRef } from "react";
import { Snowflake } from "lucide-react";
import { GaClose } from "./components/ga/Buttons";
import { collapseFreezeConsole, dismissFreezeJob, openFreezeConsole, useFreezeConsole, type FreezeJob } from "./freezeJobs";
import { formatBytes } from "./GenericDownloadProgress";
import { useI18n, type TranslationKey } from "./i18n";
import type { FreezeEvent, FreezeProgress } from "./native";
import "./freeze-console.css";

export type Translate = ReturnType<typeof useI18n>["t"];
export const STEP_KEYS: Record<string, TranslationKey> = {
  scan: "freezeStepScan", compress: "freezeStepCompress", verify: "freezeStepVerify", clear: "freezeStepClear",
  decompress: "freezeStepDecompress", extract: "freezeStepExtract", check: "freezeStepCheck",
};
export const STEPS_OF = { freeze: ["scan", "compress"], deep: ["scan", "compress", "verify", "clear"], thaw: ["decompress"] } as const;

export const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600), minutes = Math.floor((whole % 3600) / 60), rest = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
};

/** One line of the console from a launcher event. */
export function eventText(event: FreezeEvent, job: FreezeJob, t: Translate): string {
  const size = (value: unknown) => formatBytes(Number(value) || 0);
  switch (event.kind) {
    case "start": return t(job.mode === "thaw" ? "freezeEvStartThaw" : job.mode === "deep" ? "freezeEvStartDeep" : "freezeEvStartFreeze");
    case "files": return t("freezeEvFiles", { count: String(event.count ?? 0), size: size(event.bytes) });
    case "threads": return t("freezeEvThreads", { count: String(event.count ?? 1) });
    case "step": return `→ ${t(STEP_KEYS[String(event.name)] ?? "freezeStepCompress")}`;
    case "file": return event.stored != null ? t("freezeEvFileStored", { name: String(event.name), size: size(event.bytes), stored: size(event.stored) })
      : t("freezeEvFile", { name: String(event.name), size: size(event.bytes) });
    case "skipped": return t("freezeEvSkipped", { name: String(event.name) });
    case "archived": return t("freezeEvArchived", { size: size(event.bytes) });
    case "verified": return t("freezeEvVerified");
    case "done": return event.original != null ? t("freezeEvDone", { original: size(event.original), stored: size(event.stored), time: clock(Number(event.seconds) || 0) })
      : t("freezeEvDoneThaw", { time: clock(Number(event.seconds) || 0) });
    case "failed": return t("freezeEvFailed", { error: String(event.error ?? "") });
    default: return event.kind;
  }
}

/** The picture of the work: files slide into a press and come out as a block of ice that fills up with the progress
 *  (a strapped crate for the deep freeze). A thaw runs the other way. Stands still when done or with reduced motion. */
export function FreezeArt({ mode, percent, state }: { mode: FreezeJob["mode"]; percent: number; state: "working" | "done" | "failed" }) {
  const fill = mode === "thaw" ? 100 - percent : percent;
  const level = 74 - (fill / 100) * 56;
  return (
    <svg className={`gfc-art is-${state}${mode === "thaw" ? " is-thaw" : ""}${mode === "deep" ? " is-deep" : ""}`} viewBox="0 0 300 110" aria-hidden="true">
      <defs>
        <clipPath id="gfc-ice"><rect x="196" y={level} width="84" height="90" /></clipPath>
        <linearGradient id="gfc-frost" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: "var(--ga-frost)", stopOpacity: .95 }} /><stop offset="1" style={{ stopColor: "var(--ga-frost)", stopOpacity: .4 }} /></linearGradient>
      </defs>
      <g className="gfc-flow">
        <path className="gfc-belt" d="M8 86 H150" />
        {[0, 1, 2, 3, 4].map(index => (
          <g key={index} className="gfc-doc" style={{ animationDelay: `${index * -0.56}s` }}>
            <path d="M0 0 H16 L22 6 V30 H0 Z M16 0 V6 H22" />
            <path className="gfc-doc-lines" d="M4 12 H18 M4 17 H18 M4 22 H13" />
          </g>
        ))}
        <g className="gfc-press">
          <rect className="gfc-press-frame" x="128" y="22" width="44" height="72" rx="4" />
          <rect className="gfc-plate gfc-plate-top" x="132" y="26" width="36" height="8" rx="2" />
          <rect className="gfc-plate gfc-plate-bottom" x="132" y="82" width="36" height="8" rx="2" />
          <path className="gfc-belt" d="M172 86 H196" />
        </g>
        <g className="gfc-cube">
          <path className="gfc-cube-back" d="M200 30 L238 16 L276 30 L276 78 L238 94 L200 78 Z" />
          <g clipPath="url(#gfc-ice)">
            <path className="gfc-cube-ice" d="M200 30 L238 44 L238 94 L200 78 Z" />
            <path className="gfc-cube-ice is-side" d="M238 44 L276 30 L276 78 L238 94 Z" />
          </g>
          <path className="gfc-cube-edge" d="M200 30 L238 16 L276 30 L238 44 Z M200 30 V78 L238 94 L276 78 V30 M238 44 V94" />
          {mode === "deep" ? <path className="gfc-strap" d="M219 37 V86 M257 37 V86 M200 54 L238 68 L276 54" /> : null}
          {[[214, 24], [262, 22], [282, 52], [192, 50], [250, 100]].map(([x, y], index) => (
            <path key={index} className="gfc-spark" style={{ animationDelay: `${index * 0.37}s` }} d={`M${x} ${y - 5} V${y + 5} M${x - 5} ${y} H${x + 5} M${x - 3.5} ${y - 3.5} L${x + 3.5} ${y + 3.5} M${x + 3.5} ${y - 3.5} L${x - 3.5} ${y + 3.5}`} />
          ))}
        </g>
      </g>
    </svg>
  );
}

export function stats(progress: FreezeProgress | undefined) {
  if (!progress || progress.finished) return { speed: 0, eta: 0 };
  const elapsed = Math.max(0.5, progress.updated_at - progress.started_at);
  const speed = progress.done_bytes / elapsed;
  const share = progress.percent / 100;
  return { speed, eta: share > 0.02 ? elapsed * (1 - share) / share : 0 };
}

function JobView({ job, t }: { job: FreezeJob; t: Translate }) {
  const progress = job.progress;
  const state = job.outcome ? (job.outcome.ok ? "done" : "failed") : "working";
  const percent = job.outcome?.ok ? 100 : progress?.percent ?? 0;
  const steps: readonly string[] = progress?.steps ?? STEPS_OF[job.mode];
  const current = steps.indexOf(progress?.step ?? steps[0]);
  const { speed, eta } = stats(progress);
  const log = useRef<HTMLOListElement>(null);
  const events = progress?.events ?? [];
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [events.length]);
  return (<>
    <div className="gfc-stage">
      <FreezeArt mode={job.mode} percent={percent} state={state} />
      <div className="gfc-figures">
        <strong>{Math.floor(percent)}<small>%</small></strong>
        {progress?.total_bytes ? <span>{formatBytes(progress.done_bytes)} / {formatBytes(progress.total_bytes)}</span> : null}
        {state === "working" && speed > 0 ? <span>{t("freezeSpeed", { speed: formatBytes(speed) })}{eta ? ` · ${t("freezeEta", { time: clock(eta) })}` : ""}</span> : null}
        {state !== "working" ? <span className={`gfc-result is-${state}`}>{job.outcome?.detail}</span> : null}
      </div>
    </div>
    <ol className="gfc-steps">
      {steps.map((step, index) => {
        const status = state === "done" || index < current ? "done" : index === current ? (state === "failed" ? "failed" : "active") : "pending";
        return <li key={step} className={`is-${status}`}><i />{t(STEP_KEYS[step] ?? "freezeStepCompress")}</li>;
      })}
    </ol>
    <div className={`gfc-bar is-${state}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(percent)}><i style={{ width: `${percent}%` }} /></div>
    <p className="gfc-file" title={progress?.file || undefined}>{state === "working" ? progress?.file || " " : " "}</p>
    <ol ref={log} className="gfc-log" tabIndex={-1}>
      {events.map((event, index) => (
        <li key={index} className={`is-${event.kind}`}><time>{clock(event.at - (progress?.started_at ?? event.at))}</time><span>{eventText(event, job, t)}</span></li>
      ))}
      {state === "working" ? <li className="gfc-cursor"><time>{clock((progress?.updated_at ?? 0) - (progress?.started_at ?? 0))}</time><span>▍</span></li> : null}
    </ol>
  </>);
}

/** The freeze console: a floating panel at the bottom left, outside the flow of the app (nothing else is blocked).
 *  It shows the job of the game being frozen or thawed, its steps, bar, speed, time left, the file being worked on
 *  and the launcher's events. Its close folds it into a chip while the work goes on; once the work ends, it takes
 *  the job out. */
export default function FreezeConsole() {
  const { t } = useI18n();
  const state = useFreezeConsole();
  const { open, focus } = state;
  // A job shown in place (its row in the Library Manager) is not repeated here.
  const jobs = state.jobs.filter(item => !state.inline.includes(item.appId));
  if (!jobs.length) return null;
  const job = jobs.find(item => item.appId === focus) ?? jobs[jobs.length - 1];
  const working = jobs.filter(item => !item.outcome);
  const title = t(job.mode === "thaw" ? "freezeConsoleThaw" : job.mode === "deep" ? "freezeConsoleDeep" : "freezeConsoleFreeze");
  if (!open) {
    const shown = working[0] ?? job;
    return (
      <button type="button" className={`ga-freeze-chip${shown.outcome ? (shown.outcome.ok ? " is-done" : " is-failed") : ""}`} onClick={() => openFreezeConsole(shown.appId)}
        title={t("freezeConsoleShow", { name: shown.name })} aria-label={t("freezeConsoleShow", { name: shown.name })}>
        <Snowflake size={16} className={shown.outcome ? "" : "gfc-spin"} aria-hidden="true" />
        <span>{shown.name}</span>
        <b>{shown.outcome ? (shown.outcome.ok ? t("freezeConsoleDone") : t("freezeConsoleFailed")) : `${Math.floor(shown.progress?.percent ?? 0)}%`}</b>
      </button>
    );
  }
  return (
    <aside className="ga-freeze-console" aria-label={t("freezeConsoleLabel")}>
      <header>
        <div><span className="gfc-eyebrow">{title}</span><h3 title={job.name}>{job.name}</h3></div>
        <GaClose label={job.outcome ? t("close") : t("freezeConsoleHide")} onClick={() => (job.outcome ? dismissFreezeJob(job.appId) : collapseFreezeConsole())} />
      </header>
      {jobs.length > 1 ? <div className="gfc-tabs">
        {jobs.map(item => <button key={item.appId} type="button" aria-pressed={item.appId === job.appId} onClick={() => openFreezeConsole(item.appId)}>{item.name}</button>)}
      </div> : null}
      <JobView key={job.appId} job={job} t={t} />
    </aside>
  );
}
