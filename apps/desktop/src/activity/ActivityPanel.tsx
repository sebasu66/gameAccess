import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Download, Info, Snowflake, X } from "lucide-react";
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import { activeDownloadService } from "../downloads/activeService";
import { GaButton } from "../components/ga/Buttons";
import { cancelFreezeJob, freezeTitle, useFreezeConsole } from "../freezeJobs";
import { useI18n } from "../i18n";
import { openLibraryManager } from "../libraryManagerNav";
import { confirmNotice } from "../notice/notice";
import { noticeGame } from "../notice/noticeGame";
import { clearActivity, markActivitySeen, useActivity, type ActivityEntry } from "./activity";
import "./activity.css";

type Running = { key: string; appId: number; title: string; percent: number | null; waiting?: string; cancelling?: boolean; cancel: () => void };

/** The downloads that have not ended, kept up to date. */
function useActiveDownloads() {
  const pending = () => activeDownloadService().getDownloads().filter(entry => !isDownloadHistory(entry.snapshot.phase));
  const [downloads, setDownloads] = useState(pending);
  useEffect(() => activeDownloadService().onGlobalUpdate(() => setDownloads(pending())), []); // eslint-disable-line react-hooks/exhaustive-deps
  return downloads;
}

/** One running process: its name, its bar, cancel; a click takes to its game's row in the Library Manager. */
function RunningRow({ item, onOpen }: { item: Running; onOpen?: () => void }) {
  const { t } = useI18n();
  return <li className="ga-process-task">
    <button type="button" className="ga-process-task-open" aria-label={t("tasksOpen", { name: item.title })} onClick={() => { onOpen?.(); openLibraryManager(item.appId); }}>
      <span className="ga-process-task-name">{item.title}</span>
      <span className="ga-process-task-state">{item.waiting ?? `${Math.round(item.percent ?? 0)}%`}</span>
      <span className="ga-process-task-bar" aria-hidden="true"><i style={{ width: `${item.waiting ? 0 : item.percent ?? 0}%` }} /></span>
    </button>
    <button type="button" className="ga-process-task-cancel" disabled={item.cancelling} aria-label={t("downloadsCancel")} title={t("downloadsCancel")} onClick={item.cancel}><X size={16} aria-hidden="true" /></button>
  </li>;
}

const ICON = { ok: Check, info: Info, frost: Snowflake, danger: AlertTriangle, error: AlertTriangle } as const;

/** One entry of the history: cover or the tone's icon, title, text, when, and the way to its game's row. */
function HistoryRow({ entry, onOpen }: { entry: ActivityEntry; onOpen?: () => void }) {
  const { t, locale } = useI18n();
  const Icon = entry.key.startsWith("download:") && entry.state === "done" ? Download : ICON[entry.tone];
  const time = (at: number) => new Date(at).toLocaleTimeString(locale === "es" ? "es-AR" : "en-US", { hour: "2-digit", minute: "2-digit" });
  const span = entry.endedAt && entry.endedAt - entry.startedAt > 60_000 ? `${time(entry.startedAt)} – ${time(entry.endedAt)}` : time(entry.endedAt ?? entry.startedAt);
  const body: ReactNode = <>
    {entry.image ? <img className="ga-activity-art" src={entry.image} alt="" /> : <span className="ga-activity-icon"><Icon size={16} aria-hidden="true" /></span>}
    <span className="ga-activity-text"><strong>{entry.title}</strong>{entry.text ? <span>{entry.text}</span> : null}</span>
    <time className="ga-activity-time">{span}</time>
  </>;
  return <li className="ga-activity-entry" data-state={entry.state} data-tone={entry.tone} data-unseen={!entry.seen || undefined}>
    {entry.appId
      ? <button type="button" className="ga-activity-link" aria-label={t("tasksOpen", { name: entry.name ?? entry.title })} onClick={() => { onOpen?.(); openLibraryManager(entry.appId); }}>{body}</button>
      : <div className="ga-activity-link">{body}</div>}
  </li>;
}

/** "Today", "Yesterday" or the date: the history's groups. */
function dayLabel(at: number, t: ReturnType<typeof useI18n>["t"], locale: string): string {
  const day = new Date(at); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  return days === 0 ? t("activityToday") : days === 1 ? t("activityYesterday") : day.toLocaleDateString(locale === "es" ? "es-AR" : "en-US", { day: "numeric", month: "long" });
}

/**
 * The Activity panel (docs/GUI_DESIGN.md §4.9 and §4.17): what is running on top (downloads and long tasks, with
 * their bar and cancel), then the history of every notice and process, newest first, grouped by day; each entry with
 * a game takes to its row in the Library Manager, where each download and task keeps its detail. Stage: prototype.
 */
export default function ActivityPanel({ onOpen }: { onOpen?: () => void }) {
  const { t, locale } = useI18n();
  const downloads = useActiveDownloads();
  const jobs = useFreezeConsole().jobs.filter(job => !job.outcome);
  const history = useActivity().filter(entry => entry.state !== "running");
  useEffect(() => { markActivitySeen(); }, [history.length]);

  const running: Running[] = [
    ...downloads.map(({ game, snapshot }) => ({
      key: `download:${snapshot.gameId}`, appId: game.app_id ?? snapshot.gameId, title: game.name, percent: snapshot.progress ?? 0,
      waiting: snapshot.phase === "queued" ? t("downloadQueued") : snapshot.phase === "paused" ? t("downloadPaused") : undefined,
      cancel: () => void confirmNotice({ game: noticeGame(game), title: t("cancelDownloadTitle", { name: game.name }), text: t("cancelDownloadBody"), confirmLabel: t("downloadsCancel"), cancelLabel: t("keepDownloading") })
        .then(ok => { if (ok) void activeDownloadService().cancel(snapshot.gameId); }),
    })),
    ...jobs.map(job => ({
      key: `job:${job.appId}`, appId: job.appId, title: freezeTitle(job.mode, job.name), percent: job.progress?.percent ?? 0,
      waiting: job.queued ? t("tasksWaiting") : undefined, cancelling: job.cancelling, cancel: () => cancelFreezeJob(job.appId),
    })),
  ];

  const groups: Array<{ label: string; entries: ActivityEntry[] }> = [];
  for (const entry of history) {
    const label = dayLabel(entry.endedAt ?? entry.startedAt, t, locale);
    if (groups.at(-1)?.label === label) groups.at(-1)!.entries.push(entry); else groups.push({ label, entries: [entry] });
  }

  return <div className="ga-activity">
    {running.length ? <section className="ga-process-tasks" aria-labelledby="ga-activity-running">
      <h3 id="ga-activity-running" className="ga-label">{t("activityRunning")}</h3>
      <ul>{running.map(item => <RunningRow key={item.key} item={item} onOpen={onOpen} />)}</ul>
    </section> : null}
    <section className="ga-activity-history" aria-labelledby="ga-activity-history">
      <h3 id="ga-activity-history" className="ga-label">{t("activityHistory")}</h3>
      {groups.length ? groups.map(group => <div key={group.label} className="ga-activity-day">
        <h4 className="ga-activity-day-label">{group.label}</h4>
        <ul>{group.entries.map(entry => <HistoryRow key={entry.id} entry={entry} onOpen={onOpen} />)}</ul>
      </div>) : <p className="ga-hint">{t("activityEmpty")}</p>}
      {groups.length ? <div className="ga-actions"><GaButton onClick={clearActivity}>{t("activityClear")}</GaButton></div> : null}
    </section>
  </div>;
}
