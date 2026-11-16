/**
 * Library › Downloads › In progress as the prototype's wizard (vault/Rediseño de navegación.md §5.10, RN9): the
 * five stages as arrow buttons (done green, the running one in the mode colour, failed red, pending grey), and under
 * them the stage being looked at: its lines with their state and time, its figures, its actions and its log. Any stage
 * can be looked at; the view follows the running one until the player picks another. While several torrents race to be
 * the source, the preparation shows them as live lanes.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type { DownloadProgressSnapshot, RaceLane } from "../downloadProvider";
import { formatDownloadBytes } from "../downloadSize";
import { formatElapsed } from "../downloadStepModel";
import { useElapsed } from "../DownloadSteps";
import { STAGE_HINTS, STAGE_TITLES, STEAM_STAGE_HINTS, wizardStages, type StageState, type WizardStage, type WizardSub } from "../downloadWizard";
import type { DownloadEvent } from "../downloadEvents";
import type { DownloadSpeedSample } from "../catalog/DigitalDownloadService";
import { ChevronDown } from "lucide-react";
import { GaButton } from "../components/ga/Buttons";
import "./download-wizard.css";

export interface WizardFigure { label: string; value: string; hint?: string }

const MARK: Record<WizardSub["state"], string> = { done: "✓", current: "●", pending: "○", skipped: "–", failed: "✕" };
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function Sub({ sub }: { sub: WizardSub }) {
  const { t } = useI18n();
  const elapsed = useElapsed(sub.state === "current" ? sub.startedAt : undefined);
  const text = sub.state === "pending" ? t("dlWzPending") : sub.state === "skipped" && !sub.text ? t("dlStepSkipped") : sub.text;
  const time = sub.state === "current" ? (typeof sub.percent === "number" ? `${Math.round(sub.percent)}%` : elapsed ?? t("dlWzInProgress"))
    : sub.state === "failed" ? t("dlWzFailed") : sub.state === "done" && sub.ms ? formatElapsed(sub.ms) : "";
  return <li className={`ga-wz-sub is-${sub.state}`}>
    <i aria-hidden="true">{MARK[sub.state]}</i>
    <div><b>{t(sub.title as Parameters<typeof t>[0])}</b>{text ? <small>{text}</small> : null}</div>
    <span>{time}</span>
  </li>;
}

function Lanes({ lanes }: { lanes: RaceLane[] }) {
  const { t, locale } = useI18n();
  const most = Math.max(1, ...lanes.map(lane => lane.done));
  return <div className="ga-wz-race" aria-label={t("dlRaceTitle")}>
    <span className="ga-wz-eyebrow">{t("dlRaceTitle")}</span>
    <ul>{lanes.map((lane, index) => <li key={`${lane.title}-${index}`} className={`is-${lane.state}`}>
      <div className="ga-wz-lane-head"><b title={lane.title}>{lane.title || t("dlRaceUnnamed")}</b>
        <span>{lane.state === "won" ? t("dlRaceWon") : lane.state === "out" ? t("dlRaceOut") : `${formatDownloadBytes(lane.speed, locale)}/s`}</span></div>
      <div className="ga-wz-lane-bar"><u style={{ inlineSize: `${(lane.done / most) * 100}%` }} /></div>
      <small>{[lane.provider, t("dlRaceSeeds", { n: lane.seeds }), formatDownloadBytes(lane.done, locale)].filter(Boolean).join(" · ")}</small>
    </li>)}</ul>
  </div>;
}

/** The last minute of speed as a line over an area, scaled to its peak (the chart's box is 600 x 100). */
export function speedPath(samples: readonly DownloadSpeedSample[]): { line: string; area: string; peak: number } {
  const peak = Math.max(0, ...samples.map(sample => sample.speedBps));
  const end = samples.at(-1)?.time ?? 0;
  const points = samples.map(sample => [Math.max(0, Math.min(600, (sample.time - end + 60000) / 100)), 92 - (peak > 0 ? sample.speedBps / peak * 82 : 0)] as const);
  if (points.length < 2) return { line: "", area: "", peak };
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${points.at(-1)![0].toFixed(1)},100 L${points[0][0].toFixed(1)},100 Z`, peak };
}

function SpeedChart({ samples }: { samples: readonly DownloadSpeedSample[] }) {
  const { t, locale } = useI18n();
  const { line, area, peak } = speedPath(samples);
  return <figure className="ga-wz-chart">
    <figcaption><span className="ga-wz-eyebrow">{t("downloadsSpeed")}</span>
      <span>{t("downloadsPeakSpeed")} · {samples.length ? `${formatDownloadBytes(peak, locale)}/s` : "—"}</span></figcaption>
    {line ? <svg viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label={t("downloadsSpeedChart")}>
      <path className="ga-wz-chart-grid" d="M0,10 H600 M0,51 H600 M0,92 H600" />
      <path className="ga-wz-chart-area" d={area} />
      <path className="ga-wz-chart-line" d={line} />
    </svg> : <div className="ga-wz-none">{t("downloadsWaitingSamples")}</div>}
  </figure>;
}

function Log({ events, state, stageNumber }: { events: DownloadEvent[]; state: StageState; stageNumber: number }) {
  const { t } = useI18n();
  const live = state === "current" || state === "failed";
  const rows = [...events].reverse();
  return <div className="ga-wz-logbox">
    <div className="ga-wz-logh"><span>{t("dlWzLog", { n: stageNumber })}</span>
      <span className={state === "failed" ? "is-error" : state === "current" ? "is-live" : ""}>{state === "failed" ? `● ${t("dlWzError")}` : state === "current" ? `● ${t("dlWzLive")}` : state === "done" ? t("dlWzClosed") : "—"}</span></div>
    <div className="ga-wz-log" role="log" aria-live="polite" tabIndex={-1}>
      {state === "pending" || !rows.length ? <div className="ga-wz-none">{state === "pending" ? t("dlWzNotStarted") : t("dlWzNoLines")}</div>
        : rows.map((event, index) => <div key={`${event.at}-${index}`} className={`ga-wz-line is-${event.level}${index === 0 && live ? " is-new" : ""}`} style={{ ["--ga-wz-i" as string]: index }}>
          <time>{clock(event.at)}</time><span className="ga-wz-level">{event.level}</span><span>{event.text}</span>
        </div>)}
    </div>
  </div>;
}

export default function DownloadWizard({ name, cover, snapshot, events, samples = [], figures, actions, onStageActions, expanded = true, onExpand, fromSteam = false }: {
  name: string; cover: ReactNode; snapshot: DownloadProgressSnapshot; events: DownloadEvent[];
  /** A free Steam game (DepotDownloader into the Steam library): its own steps, before the launcher names any. */
  fromSteam?: boolean;
  /** The last minute of speed, drawn in the Download stage while it transfers. */
  samples?: readonly DownloadSpeedSample[];
  /** Only one of the downloads in progress shows its detail at a time; the others are one row that opens it. */
  expanded?: boolean;
  onExpand?: () => void;
  /** The figures under each stage's lines (route, plan and source; speed, time left…). */
  figures: (stage: WizardStage) => WizardFigure[];
  /** The actions of the stage the download is at (pause, cancel, retry, play…); other stages have none. */
  actions: ReactNode;
  /** Actions of a stage the download already went through (open the folder…), if any. */
  onStageActions?: (stage: WizardStage) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const { stages, at, steam } = wizardStages(snapshot, fromSteam ? true : undefined);
  const [picked, setPicked] = useState<number | null>(null);
  // The view follows the running stage; a stage the player picked stays until the download moves on.
  useEffect(() => { setPicked(null); }, [at]);
  const viewIndex = picked ?? at;
  const view = stages[viewIndex];
  const current = stages[at];
  const failed = current.state === "failed";
  const finished = snapshot.phase === "completed";
  const lead = finished ? t("dlWzReadyText") : failed ? t("dlWzStoppedText", { stage: t(STAGE_TITLES[current.id]) }) : t("dlWzRunningText");
  const eyebrow = finished ? t("dlWzInstalled") : `${t("dlWzStageOf", { n: at + 1, total: stages.length, name: t(STAGE_TITLES[current.id]) })}${failed ? ` · ${t("dlWzStopped")}` : ""}`;
  const stateText = (stage: WizardStage) => stage.state === "done" ? t("dlWzDone") : stage.state === "failed" ? t("dlWzFailed")
    : stage.state === "current" ? (typeof stage.percent === "number" ? `${Math.round(stage.percent)}%` : t("dlWzInProgress")) : t("dlWzPending");
  const own = viewIndex === at ? actions : onStageActions?.(view);
  const shown = figures(view);
  // A card the player opens comes whole into view, its actions included.
  const card = useRef<HTMLElement>(null);
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    if (expanded && !wasExpanded.current) card.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    wasExpanded.current = expanded;
  }, [expanded]);
  const overall = Math.max(0, Math.min(100, snapshot.progress ?? 0));
  // The same head for an open card and a closed one; closed, it adds the speed and percent and the button that opens it.
  const head = <header className="ga-wz-top" onClick={expanded ? undefined : onExpand}>
    <div className="ga-wz-cover">{cover}</div>
    <div><span className="ga-wz-eyebrow">{eyebrow}</span><h3 className="ga-wz-name">{name}</h3><p className="ga-wz-lead">{lead}</p></div>
    {expanded ? null : <div className="ga-wz-open">
      <span className="ga-wz-row-state">{snapshot.phase === "downloading" && snapshot.speedBps ? `${formatDownloadBytes(snapshot.speedBps, locale)}/s · ` : ""}{failed ? t("dlWzFailed") : `${Math.round(overall)}%`}</span>
      <GaButton variant="secondary" icon={<ChevronDown size={16} aria-hidden="true" />} aria-expanded={false} onClick={event => { event.stopPropagation(); onExpand?.(); }}><span>{t("dlWzOpen")}</span></GaButton>
    </div>}
  </header>;
  if (!expanded) {
    return <article ref={card} className={`ga-wz is-collapsed${failed ? " is-failed" : ""}`} aria-label={name}>
      {head}
      <progress className="ga-wz-bar" max={100} value={overall} aria-label={`${name} ${Math.round(overall)}%`} />
    </article>;
  }
  return <article ref={card} className={`ga-wz${failed ? " is-failed" : ""}`} aria-label={name}>
    {head}
    <ol className="ga-wz-steps" aria-label={t("dlStepsTitle")}>
      {stages.map((stage, index) => <li key={stage.id}>
        <button type="button" className={`ga-wz-step is-${stage.state}`} aria-current={index === viewIndex ? "step" : undefined} onClick={() => setPicked(index === at ? null : index)}
          aria-label={`${index + 1}. ${t(STAGE_TITLES[stage.id])} · ${stateText(stage)}`} title={stateText(stage)}>
          <span aria-hidden="true">{index + 1}</span>
          <b aria-hidden="true">{t(STAGE_TITLES[stage.id])}</b>
        </button>
      </li>)}
    </ol>
    <div className="ga-wz-body">
      <div className="ga-wz-main">
        <span className="ga-wz-eyebrow">{t(STAGE_TITLES[view.id])} · {t((steam ? STEAM_STAGE_HINTS : STAGE_HINTS)[view.id])}</span>
        {typeof view.percent === "number" ? <progress className="ga-wz-bar" max={100} value={view.percent} aria-label={`${t(STAGE_TITLES[view.id])} ${Math.round(view.percent)}%`} /> : null}
        {view.id === "download" && view.state !== "pending" && (snapshot.phase === "downloading" || samples.length > 1) ? <SpeedChart samples={samples} /> : null}
        <ul className="ga-wz-subs">{view.subs.map(sub => <Sub key={sub.key} sub={sub} />)}</ul>
        {view.id === "prepare" && snapshot.race?.length ? <Lanes lanes={snapshot.race} /> : null}
        {shown.length ? <dl className="ga-wz-figures">{shown.map(figure => <div key={figure.label} title={figure.hint}><dt>{figure.label}</dt><dd>{view.state === "pending" ? "—" : figure.value}</dd></div>)}</dl> : null}
      </div>
      <Log events={events.filter(event => event.stage === view.id)} state={view.state} stageNumber={viewIndex + 1} />
    </div>
    {/* The actions sit at the base of the card, fixed: only the stage's lines above them scroll. */}
    <footer className="ga-wz-actions">{view.state === "pending" || !own ? <span className="ga-wz-none-chip">{t("dlWzNoActions")}</span> : own}</footer>
  </article>;
}
