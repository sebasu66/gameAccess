import { jobLabelKey, useFreezeConsole } from "../freezeJobs";
import { useI18n } from "../i18n";

export interface ActivityTask { key: string; label: string; detail?: string; percent: number | null }

/** One ring: the share done as an arc, or a slow turning arc when the work has no share to tell. */
function Ring({ percent }: { percent: number | null }) {
  return (
    <svg className="lm-activity-ring" viewBox="0 0 44 44" aria-hidden="true">
      <circle className="track" cx="22" cy="22" r="18" />
      {percent == null ? <circle className="turn" cx="22" cy="22" r="18" pathLength={100} strokeDasharray="22 78" />
        : <circle className="arc" cx="22" cy="22" r="18" pathLength={100} strokeDasharray={`${Math.max(0, Math.min(100, percent))} 100`} />}
    </svg>
  );
}

/**
 * What the library is doing, beside the disk chart: like the panel of a machine, drawn faintly on the background (as
 * the GAME ACCESS word on the side): a ring per task (freeze, thaw, scan, a batch of changes), its share and name;
 * a still ring when there is nothing. Information only: nothing here is clicked.
 */
export default function ActivityBoard({ scanning, working }: { scanning: boolean; working: boolean }) {
  const { t } = useI18n();
  const { jobs, paused } = useFreezeConsole();
  const tasks: ActivityTask[] = [
    ...jobs.filter(job => !job.outcome).map(job => ({
      key: `freeze-${job.appId}`, percent: job.queued ? 0 : job.progress?.percent ?? null, detail: job.name,
      label: job.queued ? t("lmActivityQueued") : paused ? t("lmActivityPaused")
        : t(jobLabelKey(job.mode)),
    })),
    ...(working ? [{ key: "batch", label: t("lmActivityWorking"), percent: null }] : []),
    ...(scanning ? [{ key: "scan", label: t("lmActivityScan"), percent: null }] : []),
  ];
  return (
    <div className={`lm-activity${tasks.length ? " is-busy" : ""}`} role="status" aria-label={t("lmActivityTitle")}>
      <span className="lm-activity-title">{t("lmActivityTitle")}</span>
      {tasks.length ? tasks.slice(0, 3).map(task => (
        <div key={task.key} className="lm-activity-task">
          <Ring percent={task.percent} />
          {task.percent != null ? <b>{Math.floor(task.percent)}</b> : null}
          <span><em>{task.label}</em>{task.detail ? <small>{task.detail}</small> : null}</span>
        </div>
      )) : <div className="lm-activity-task is-idle"><Ring percent={0} /><span><em>{t("lmActivityIdle")}</em></span></div>}
    </div>
  );
}
