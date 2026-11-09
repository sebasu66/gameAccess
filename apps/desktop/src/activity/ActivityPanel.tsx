import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, Download, HardDrive, Heart, Info, Library, RefreshCw, ShieldCheck, Snowflake, Sparkles, X, type LucideIcon } from "lucide-react";
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import { centralDialog, type TaskView } from "../centralDialog/centralDialog";
import { activeDownloadService } from "../downloads/activeService";
import { GaButton } from "../components/ga/Buttons";
import { cancelFreezeJob, freezeTitle, useFreezeConsole } from "../freezeJobs";
import { useI18n } from "../i18n";
import { setAppScreen } from "../appScreen";
import { openLibraryManager } from "../libraryManagerNav";
import { openSection } from "../gameArea";
import { openNews } from "../newDownloads";
import { openReleaseNotes } from "../releaseNotes";
import { confirmNotice } from "../notice/notice";
import { noticeGame } from "../notice/noticeGame";
import { GameThumb } from "../GameArt";
import { downloadPhaseLabel } from "../DigitalDownloadsScreen";
import type { DownloadProgressSnapshot } from "../downloadProvider";
import { formatDownloadBytes, sourceDownloadSize } from "../downloadSize";
import type { CatalogGame } from "../types";
import { activityCategory, activityGroups, clearActivity, markActivitySeen, useActivity, type ActivityCategory, type ActivityEntry, type ActivityGroup } from "./activity";
import "./activity.css";

type Running = {
  key: string; appId?: number; title: string; percent: number | null; waiting?: string; cancelling?: boolean; cancel?: () => void;
  /** What it is, over its name ("Download"). */
  kind?: string;
  /** In place of the percent, which the bar already shows: a download's speed, or its step when it is not transferring. */
  state?: string;
  /** Under the bar: how much a download has of its size. */
  detail?: string;
};

/** The downloads that have not ended, kept up to date. */
function useActiveDownloads() {
  const pending = () => activeDownloadService().getDownloads().filter(entry => !isDownloadHistory(entry.snapshot.phase));
  const [downloads, setDownloads] = useState(pending);
  useEffect(() => activeDownloadService().onGlobalUpdate(() => setDownloads(pending())), []); // eslint-disable-line react-hooks/exhaustive-deps
  return downloads;
}

/** The app's own task running in the background (download sources, catalog updates), kept up to date. */
function useBackgroundTask(): TaskView | null {
  const [task, setTask] = useState<TaskView | null>(null);
  useEffect(() => centralDialog.subscribe(state => setTask(state.task?.background ? state.task : null)), []);
  return task;
}

/** One running process: its name, its bar, cancel; a click takes to Downloads, or to its game's row in the Library Manager. The app's
 *  own tasks have no game and cannot be cancelled. */
function RunningRow({ item, onOpen }: { item: Running; onOpen?: () => void }) {
  const { t } = useI18n();
  const content = <>
    {item.kind ? <span className="ga-process-task-kind">{item.kind}</span> : null}
    <span className="ga-process-task-name">{item.title}</span>
    <span className="ga-process-task-state">{item.waiting ?? item.state ?? `${Math.round(item.percent ?? 0)}%`}</span>
    <span className="ga-process-task-bar" aria-hidden="true"><i style={{ width: `${item.waiting ? 0 : item.percent ?? 0}%` }} /></span>
    {item.detail ? <span className="ga-process-task-detail">{item.detail}</span> : null}
  </>;
  return <li className="ga-process-task" data-app-task={item.appId === undefined || undefined}>
    {item.appId !== undefined
      ? <button type="button" className="ga-process-task-open" aria-label={t("tasksOpen", { name: item.title })} onClick={() => { onOpen?.(); if (item.key.startsWith("download:")) openSection("downloads"); else openLibraryManager(item.appId); }}>{content}</button>
      : <div className="ga-process-task-open" role="status">{content}</div>}
    {item.cancel ? <button type="button" className="ga-process-task-cancel" disabled={item.cancelling} aria-label={t("downloadsCancel")} title={t("downloadsCancel")} onClick={item.cancel}><X size={16} aria-hidden="true" /></button> : null}
  </li>;
}

/** "1,2 GB de 8,4 GB": what a download has of its size (the source's size until the transfer knows it). */
function downloadSizeText(game: CatalogGame, snapshot: DownloadProgressSnapshot, locale: ReturnType<typeof useI18n>["locale"], t: ReturnType<typeof useI18n>["t"]): string | undefined {
  const total = (snapshot.bytesTotal ?? 0) > 0 ? formatDownloadBytes(snapshot.bytesTotal, locale) : sourceDownloadSize(game, locale);
  if (!total) return undefined;
  return (snapshot.bytesDownloaded ?? 0) > 0 ? t("activityDownloadSize", { done: formatDownloadBytes(snapshot.bytesDownloaded, locale), total }) : total;
}

/** The kinds of entries, each with its icon; its colour and gradient are in activity.css (`data-kind`). */
const KIND_ICON: Record<string, LucideIcon> = { news: Sparkles, taste: Heart, verify: ShieldCheck, download: Download, freeze: Snowflake, task: RefreshCw, failed: AlertTriangle, done: Check, info: Info };

/** The groups of the panel, each with its icon; its colour is in activity.css (`data-kind`). */
const CATEGORY_ICON: Record<ActivityCategory, LucideIcon> = { news: Sparkles, catalog: Library, downloads: Download, library: HardDrive, app: RefreshCw, taste: Heart, other: Info };

/** What an entry is about: its own kind, or its process (by its key), or how it ended. */
export function entryKind(entry: ActivityEntry): string {
  if (entry.state === "failed") return "failed";
  if (entry.kind) return entry.kind;
  if (entry.key.startsWith("download:")) return "download";
  if (entry.tone === "frost" || /^(freeze|job):/.test(entry.key)) return "freeze";
  return entry.state === "done" ? "done" : "info";
}

/** "Today", "Yesterday" or the date: the history's groups. */
function dayLabel(at: number, t: ReturnType<typeof useI18n>["t"], locale: string): string {
  const day = new Date(at); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  return days === 0 ? t("activityToday") : days === 1 ? t("activityYesterday") : day.toLocaleDateString(locale === "es" ? "es-AR" : "en-US", { day: "numeric", month: "long" });
}

/** When something happened: the day and the hour ("Hoy 14:03"), since a group spans days. */
function useWhen() {
  const { t, locale } = useI18n();
  const hour = (at: number) => new Date(at).toLocaleTimeString(locale === "es" ? "es-AR" : "en-US", { hour: "2-digit", minute: "2-digit" });
  return { hour, when: (at: number) => `${dayLabel(at, t, locale)} ${hour(at)}` };
}

/** Where an entry's detail is: its news item or the version's notes on Home, Downloads, or the Library Manager. */
function entryDestination(entry: ActivityEntry): (() => void) | null {
  const category = activityCategory(entry);
  if (entry.news) return () => openNews(entry.news!);
  if (category === "app") return openReleaseNotes;
  if (category === "catalog" || category === "news") return () => setAppScreen("home");
  // A download is followed in the Catalog's Downloads (gameArea.ts); the rest of a game's story in the Library Manager.
  if (category === "downloads") return () => openSection("downloads");
  if (entry.appId || category === "library" || entry.state === "failed") return () => openLibraryManager(entry.appId);
  return null;
}

/** One entry of a group: its kind's icon (with the game's cover when it has one), when, title, text, and the way to its
 *  section of the app. */
function HistoryRow({ entry, onOpen }: { entry: ActivityEntry; onOpen?: () => void }) {
  const { t } = useI18n();
  const { hour, when } = useWhen();
  const kind = entryKind(entry);
  const Icon = KIND_ICON[kind] ?? Info;
  const lines = entry.lines && entry.lines.length > 1 ? entry.lines : null;
  const open = entryDestination(entry);
  const label = entry.news || activityCategory(entry) === "app" ? t("activityOpenNews", { name: entry.title })
    : entry.appId ? t("tasksOpen", { name: entry.name ?? entry.title }) : t("activityOpenManager");
  const body: ReactNode = <>
    <span className="ga-activity-mark">
      {entry.image || entry.appId ? <GameThumb appId={entry.appId} image={entry.image} className="ga-activity-art" /> : null}
      <span className="ga-activity-icon"><Icon size={entry.image ? 14 : 20} aria-hidden="true" /></span>
    </span>
    <span className="ga-activity-text">
      <time className="ga-activity-time">{when(entry.endedAt ?? entry.startedAt)}</time>
      <strong>{entry.title}</strong>
      {lines ? <ul className="ga-activity-lines">{lines.map(line => <li key={line.at}><time>{hour(line.at)}</time>{line.text}</li>)}</ul>
        : entry.text ? <span>{entry.text}</span> : null}
    </span>
  </>;
  return <li className="ga-activity-entry" data-kind={kind} data-state={entry.state} data-tone={entry.tone}>
    {open ? <button type="button" className="ga-activity-link" aria-label={label} onClick={() => { onOpen?.(); open(); }}>{body}</button>
      : <div className="ga-activity-link">{body}</div>}
  </li>;
}

/** A category like an Android notification group: its icon and name, how many, the last thing that happened; a click
 *  opens its entries, and each of those takes to its section of the app. */
function GroupCard({ group, fresh, open, onToggle, onOpen }: { group: ActivityGroup; fresh: boolean; open: boolean; onToggle: () => void; onOpen?: () => void }) {
  const { t } = useI18n();
  const { when } = useWhen();
  const Icon = CATEGORY_ICON[group.category];
  const last = group.entries.at(-1)!;
  const name = t(`activityCategory_${group.category}`);
  const items = `ga-activity-items-${group.category}`;
  return <li className="ga-activity-group ga-activity-entry" data-kind={group.category} data-state={last.state} data-fresh={fresh || undefined}>
    <button type="button" className="ga-activity-link" aria-expanded={open} aria-controls={items} onClick={onToggle}>
      <span className="ga-activity-mark"><span className="ga-activity-icon"><Icon size={20} aria-hidden="true" /></span></span>
      <span className="ga-activity-text">
        <time className="ga-activity-time">{when(group.lastAt)}</time>
        <strong>{name} ({group.entries.length}){fresh ? <i className="ga-activity-new" title={t("activityNew")} /> : null}</strong>
        <span>{last.text && last.title === name ? last.text : last.text ? `${last.title}: ${last.text}` : last.title}</span>
      </span>
      <ChevronRight className="ga-activity-chevron" size={20} aria-hidden="true" />
    </button>
    {open ? <ul id={items} className="ga-activity-items">{group.entries.map(entry => <HistoryRow key={entry.id} entry={entry} onOpen={onOpen} />)}</ul> : null}
  </li>;
}

/**
 * The Activity panel (docs/GUI_DESIGN.md §4.9 and §4.17): the history as one group per category, the newest at the
 * bottom, where the panel opens; under it what is running (downloads and long tasks, with their bar and cancel), the
 * newest of all. Each entry takes to its section of the app. Stage: prototype.
 */
export default function ActivityPanel({ onOpen }: { onOpen?: () => void }) {
  const { t, locale } = useI18n();
  const downloads = useActiveDownloads();
  const jobs = useFreezeConsole().jobs.filter(job => !job.outcome);
  const task = useBackgroundTask();
  const step = task?.steps.find(item => item.state === "running");
  const activity = useActivity();
  const groups = useMemo(() => activityGroups(activity), [activity]);
  const [expanded, setExpanded] = useState<Set<ActivityCategory>>(new Set());
  // Categories with something the player has not opened yet; the seen mark itself goes as soon as the panel shows them.
  const [fresh, setFresh] = useState<Set<ActivityCategory>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const newest = groups.at(-1)?.lastAt;
  useEffect(() => {
    const unseen = groups.filter(group => group.unseen).map(group => group.category);
    if (unseen.length) setFresh(previous => new Set([...previous, ...unseen]));
    markActivitySeen();
  }, [groups]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [newest]);
  const toggle = (category: ActivityCategory) => {
    setExpanded(previous => { const next = new Set(previous); if (!next.delete(category)) next.add(category); return next; });
    setFresh(previous => { const next = new Set(previous); next.delete(category); return next; });
  };

  const running: Running[] = [
    // A download says it is one, its speed and how much it has of its size: the bar already shows the percent (Seba, 2026-11-03).
    ...downloads.map(({ game, snapshot }) => ({
      key: `download:${snapshot.gameId}`, appId: game.app_id ?? snapshot.gameId, title: game.name, percent: snapshot.progress ?? 0, kind: t("activityDownload"),
      waiting: snapshot.phase === "queued" ? t("downloadQueued") : snapshot.phase === "paused" ? t("downloadPaused") : undefined,
      state: snapshot.phase === "downloading" ? `${formatDownloadBytes(snapshot.speedBps ?? 0, locale)}/s` : downloadPhaseLabel(snapshot.phase, locale),
      detail: downloadSizeText(game, snapshot, locale, t),
      cancel: () => void confirmNotice({ game: noticeGame(game), title: t("cancelDownloadTitle", { name: game.name }), text: t("cancelDownloadBody"), confirmLabel: t("downloadsCancel"), cancelLabel: t("keepDownloading") })
        .then(ok => { if (ok) void activeDownloadService().cancel(snapshot.gameId); }),
    })),
    ...jobs.map(job => ({
      key: `job:${job.appId}`, appId: job.appId, title: freezeTitle(job.mode, job.name), percent: job.progress?.percent ?? 0,
      waiting: job.queued ? t("tasksWaiting") : undefined, cancelling: job.cancelling, cancel: () => cancelFreezeJob(job.appId),
    })),
    // Without a count the step says what it is doing (starting the plugin, reading the sources) in place of a percent.
    ...(task && step ? [{
      key: `task:${task.id}`, title: task.title, percent: step.total ? Math.min(100, (step.done ?? 0) / step.total * 100) : null,
      waiting: step.total ? undefined : step.detail ?? step.label,
    }] : []),
  ];

  return <div className="ga-activity">
    <section className="ga-activity-history" aria-labelledby="ga-activity-history">
      <div className="ga-activity-history-head">
        <h3 id="ga-activity-history" className="ga-label">{t("activityHistory")}</h3>
        {groups.length ? <GaButton onClick={clearActivity}>{t("activityClear")}</GaButton> : null}
      </div>
      {groups.length ? <ul className="ga-activity-groups">
        {groups.map(group => <GroupCard key={group.category} group={group} fresh={fresh.has(group.category)} open={expanded.has(group.category)} onToggle={() => toggle(group.category)} onOpen={onOpen} />)}
      </ul> : <p className="ga-hint">{t("activityEmpty")}</p>}
    </section>
    {running.length ? <section className="ga-process-tasks" aria-labelledby="ga-activity-running">
      <h3 id="ga-activity-running" className="ga-label">{t("activityRunning")}</h3>
      <ul>{running.map(item => <RunningRow key={item.key} item={item} onOpen={onOpen} />)}</ul>
    </section> : null}
    <div ref={end} />
  </div>;
}
