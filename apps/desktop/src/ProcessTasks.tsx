import { X } from "lucide-react";
import { setAppScreen } from "./appScreen";
import { cancelFreezeJob, freezeTitle, useFreezeConsole } from "./freezeJobs";
import { useI18n } from "./i18n";
import { openLibraryManager } from "./libraryManagerNav";
import "./process-tasks.css";

/**
 * The "Tasks" section of the processes and downloads panel (docs/GUI_DESIGN.md §0b, docs/TAREA-pantallas-y-modos.md
 * P6): only while a long task is waiting or working, each with its name, its progress and cancel; a click takes to
 * the task in the Library Manager. A finished task leaves no line: its end is told by the notice (§4.9).
 * Stage: prototype (freezes, thaws and moves; the plugin update joins later).
 */
export default function ProcessTasks({ onOpen }: { onOpen?: () => void }) {
  const { t } = useI18n();
  const running = useFreezeConsole().jobs.filter(job => !job.outcome);
  if (!running.length) return null;
  return <section className="ga-process-tasks" aria-labelledby="ga-process-tasks-title">
    <h3 id="ga-process-tasks-title" className="ga-label">{t("tasksTitle")}</h3>
    <ul>
      {running.map(job => {
        const percent = Math.round(job.progress?.percent ?? 0);
        const title = freezeTitle(job.mode, job.name);
        return <li key={job.appId} className="ga-process-task">
          <button type="button" className="ga-process-task-open" aria-label={t("tasksOpen", { name: job.name })}
            onClick={() => { onOpen?.(); setAppScreen("games"); openLibraryManager(job.appId); }}>
            <span className="ga-process-task-name">{title}</span>
            <span className="ga-process-task-state">{job.queued ? t("tasksWaiting") : `${percent}%`}</span>
            <span className="ga-process-task-bar" aria-hidden="true"><i style={{ width: `${job.queued ? 0 : percent}%` }} /></span>
          </button>
          <button type="button" className="ga-process-task-cancel" disabled={job.cancelling} aria-label={t("downloadsCancel")} title={t("downloadsCancel")} onClick={() => cancelFreezeJob(job.appId)}><X size={16} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>
  </section>;
}
