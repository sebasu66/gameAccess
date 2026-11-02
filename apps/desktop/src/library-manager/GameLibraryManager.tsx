import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { AlertTriangle, AppWindow, ShieldAlert, ShieldCheck, ArrowDown, ArrowUp, ArrowUpDown, Gamepad2, FolderInput, Loader2, RefreshCw, Snowflake, Trash2, Wand2, X } from "lucide-react";
// The row actions use Phosphor's filled icons (lucide only draws lines); the weight comes from the IconContext below.
import { ArrowClockwise, ArrowCounterClockwise, ArrowSquareIn, DotsThree, DownloadSimple, GearSix, Flame as PhFlame, FolderOpen as PhFolderOpen, IconContext, LinkBreak, MagicWand, Play as PhPlay, Scroll, Snowflake as PhSnowflake, Trash } from "@phosphor-icons/react";
import { translate, useI18n, type TranslationKey } from "../i18n";
import { normalizeSearchText } from "../libraryText";
import { notify } from "../toasts";
import { digitalProcessManager, type LibraryGame, type LibraryPlan, type RunCheck } from "../catalog/DigitalProcessManager";
import { libraryDemo, libraryScanState, scanLibrary, useLibraryScan } from "../libraryScan";
import type { CatalogGame } from "../types";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { DiskDonut } from "./Charts";
import { copy, type LibraryCopy } from "./copy";
import { demoPlans } from "./demoData";
import { formatBytes } from "./format";
import { ImportWizard } from "./ImportWizard";
import { addReadyGameToLibrary, libraryMembership, useLibraryGames } from "../libraryMembership";
import { digitalDownloadService } from "../catalog/DigitalDownloadService";
import { PlanDialog } from "./PlanDialog";
import { SizeCell } from "./SizeCell";
import FreezeDialog, { type FreezeMode } from "../FreezeDialog";
import DigitalGameOptions from "../DigitalGameOptions";
import { cancelFreezeJob, discardMove, dismissFreezeJob, freezeJob, hostFreezeJob, jobCancelKey, jobLabelKey, startFreezeJob, useFreezeJobView, type FreezeJob } from "../freezeJobs";
import { clock, eventText, stats as jobStats } from "../FreezeConsole";
import { uiDemo } from "../devDemo/uiDemo";
import ActivityBoard from "./ActivityBoard";
import FreezeBar, { freezeSize } from "./FreezeBar";
import MoveArt, { moveLeft } from "./MoveArt";
import { GaBack, GaButton } from "../components/ga/Buttons";
import { confirmNotice, hideNotice, showNotice } from "../notice/notice";
import { applyKidDraft, dropKidGames, kidGameCount, kidGamesAmong, loadKidFamily } from "../kidMode";
import { addShortcut, loadShortcuts, openShortcut, removeShortcut, useShortcuts, type AppShortcut } from "../appShortcuts";
import { showFolderInUse } from "./folderInUse";
import { noticeGame } from "../notice/noticeGame";
import { isSteamOwned, steamOwnerLabel, syncSteamLibrary } from "../steamLibrary";
import { DownloadLog, useDownloadView, type DownloadEntry } from "../downloads/DownloadDetail";
import { activeDownloadService } from "../downloads/activeService";
import { downloadPhaseLabel } from "../DigitalDownloadsScreen";
import ManualDownloadForm from "../ManualDownloadForm";
import RowExpand, { RowMenu, type RowAction } from "./RowExpand";
import { ArtworkFallback, GameWideArt } from "../GameArt";
import "./manager.css";

/** The main library re-reads the games folder on focus: fixed, discarded or removed games show up there right away. */
const notifyLibraryChanged = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("focus")); };

type Selection = { [key: string]: boolean };
type Filter = "all" | "outside" | "errors" | "partial" | "frozen";
type Pending =
  | { kind: "plan"; plans: LibraryPlan[]; ids: number[] }
  | { kind: "uninstall"; ids: number[] }
  | { kind: "steam_uninstall"; game: LibraryGame }
  | { kind: "linked_delete"; game: LibraryGame }
  | { kind: "linked_move"; game: LibraryGame }
  | { kind: "discard"; game: LibraryGame; restart: boolean };

const asGame = (game: LibraryGame): CatalogGame => ({ id: game.app_id, app_id: game.app_id, name: game.name } as CatalogGame);
const hasError = (game: LibraryGame) => (!game.unfinished || Boolean(game.stalled)) && game.issues.some(issue => issue.code === "error");
/** A folder in ERROR that Retry processes again as it is: one Fix would also do, or one whose download stopped. */
const retryable = (game: LibraryGame) => game.state === "ERROR" && (Boolean(game.stalled) || needsFix(game));
const isUnfinished = (game: LibraryGame) => Boolean(game.partial) || (Boolean(game.transfer_bytes) && !game.transfer_active);
const needsFix = (game: LibraryGame) => !game.standard && !game.partial && !game.linked && !game.unfinished && !isUnfinished(game);
const landscape = (appId: number | null | undefined) => appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` : "";

type Translate = ReturnType<typeof useI18n>["t"];
type StatusTone = "frost" | "warn" | "busy" | "muted";
type Status = { rank: number; label: string; tone: StatusTone; icon?: JSX.Element };

/** The state of a row in the grid; `rank` is its place when the grid is sorted by state (what needs attention first). */
function statusOf(game: LibraryGame, c: LibraryCopy, t: Translate): Status {
  const spin = <Loader2 className="animate-spin" />;
  if (game.frozen) return { rank: game.frozen === "deep" ? 8 : 7, label: game.frozen === "deep" ? c.deepFrozen : c.frozen, tone: "frost", icon: <Snowflake /> };
  if (isSteamOwned(game)) return { rank: 10, label: t("lmStatusSteamOwned"), tone: "muted" };
  if (game.move_pending) return { rank: 2, label: t("lmMovePending", { percent: String(Math.floor(game.move_pending.percent)) }), tone: "warn", icon: <AlertTriangle /> };
  if (game.linked) return { rank: 9, label: c.linked, tone: "muted" };
  if ((game.partial || game.unfinished || isUnfinished(game)) && !game.stalled) {
    if (game.transfer_active) return { rank: 0, label: c.downloading, tone: "busy", icon: spin };
    if (game.queued) return { rank: 1, label: c.queued, tone: "busy" };
    return { rank: 2, label: t("lmStatusPaused"), tone: "warn" };
  }
  if (hasError(game)) return { rank: 3, label: c.error, tone: "warn", icon: <AlertTriangle /> };
  if (!game.standard) return { rank: 4, label: c.outsideStd, tone: "warn", icon: <AlertTriangle /> };
  if (["installing", "downloading", "preparing"].includes(game.state)) return { rank: 5, label: c[game.state as "installing"], tone: "busy", icon: spin };
  return { rank: 6, label: t("lmStatusInstalled"), tone: "muted" };
}

/** The state of a game being frozen, thawed or waiting for that. */
function freezeStatus(job: FreezeJob, tr: typeof translate): Status {
  if (job.queued) return { rank: 1, label: tr("lmActivityQueued"), tone: "busy" };
  return { rank: 0, label: tr(jobLabelKey(job.mode)), tone: job.mode === "move" ? "busy" : "frost",
    icon: <Loader2 className="animate-spin" /> };
}

/** Where the game comes from: a direct download (DD) through Game Access, Steam, or a folder of the user's linked as is. */
type Kind = "dd" | "steam" | "folder";
const kindOf = (game: LibraryGame): Kind => game.link_kind === "steam" ? "steam" : game.linked ? "folder" : "dd";
const kindLabels: Record<Kind, [TranslationKey, TranslationKey | null]> = { dd: ["lmKindDirect", "lmKindDirectTitle"], steam: ["lmKindSteam", null], folder: ["lmKindFolder", "lmKindFolderTitle"] };

/** Who it belongs to or who provided it, shown next to the source: the Steam account that owns it, or the download's provider. */
function sourceOf(game: LibraryGame): string {
  if (game.link_kind === "steam") return steamOwnerLabel(game.steam_owner);
  return game.linked ? "" : game.source_provider ?? "";
}


const FILLED = { weight: "fill" as const };
const MENU_ICON = { weight: "fill" as const, size: 16 };
/** One action of a game, with its name: for the open row's menu and the context menu. */
const act = (label: string, icon: ReactNode, onClick: () => void, extra: Partial<RowAction> = {}): RowAction =>
  ({ label, icon: <IconContext.Provider value={MENU_ICON}>{icon}</IconContext.Provider>, onClick, ...extra });

/** Where a row's context menu opens: at the pointer (right click) or under its "⋯" button. */
type MenuAt = { x: number; y: number } | null;
const menuAt = (event: ReactMouseEvent): { x: number; y: number } => {
  if (event.type === "contextmenu") return { x: event.clientX, y: event.clientY };
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: box.right - 240, y: box.bottom + 4 };
};
/** A click on a row opens or closes it, unless it was on one of its controls. */
const onControl = (event: ReactMouseEvent) => Boolean((event.target as HTMLElement).closest("button, input, a, select, label, textarea"));

function IconAction({ label, onClick, disabled, tone, pressed, children }: { label: string; onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void; disabled?: boolean; tone?: "danger" | "frost" | "accent"; pressed?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={`lm-act${tone ? ` ${tone}` : ""}`} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><IconContext.Provider value={FILLED}>{children}</IconContext.Provider></button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The game's log. A freeze or thaw of the game going on (or just ended) is one group at its end: its title, the
 *  launcher's details indented inside it, and how it ended; the log's own lines of that freeze are left out
 *  meanwhile, so nothing shows twice. When it ends, the log is read again. */
function History({ game, c, job, download }: { game?: LibraryGame; c: LibraryCopy; job?: FreezeJob; download?: DownloadEntry }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const ended = Boolean(job?.outcome);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    // A download with no folder yet has no log of its own so far: only its running groups.
    if (!game) { setText(""); return; }
    if (libraryDemo() || uiDemo()) { setText("2026-10-12 21:04:11 | importado | carpeta adaptada al estándar actual\n2026-10-12 21:04:12 | analisis | estado=ready; ejecutable=Game/game.exe"); return; }
    void digitalProcessManager.gameLog(asGame(game as LibraryGame)).then(result => { if (live) setText(result.log ?? ""); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [game?.app_id, ended]);
  const since = job ? job.startedAt - 5000 : null;
  let lines = (text ?? "").split("\n").filter(line => line.trim() && (since == null || !isFreezeLineSince(line, since)));
  // The running download is shown as its groups: the log's own lines of it (since it started) are left out meanwhile.
  if (download) {
    const starts = lines.map((line, index) => { const [, step, detail] = line.split(" | "); return step?.trim() === "descarga" && (detail ?? "").startsWith("inicio") ? index : -1; });
    const start = Math.max(...starts);
    if (start >= 0) lines = [...lines.slice(0, start), ...lines.slice(start).filter(line => !DOWNLOAD_LOG_STEPS.includes(line.split(" | ")[1]?.trim() ?? ""))];
  }
  const events = (job?.progress?.events ?? []).filter(event => !["start", "done", "failed"].includes(event.kind));
  useEffect(() => { if ((job && !job.outcome) || download) box.current?.scrollTo({ top: box.current.scrollHeight }); }, [job, events.length, download?.snapshot.phase, download?.snapshot.step?.id]);
  return (
    <div ref={box} className="lm-history" tabIndex={-1}>
      {text === null ? <p>{c.working}</p> : !lines.length && !job && !download ? <p>{c.noHistory}</p> : lines.map((line, index) => <p key={index}>{line}</p>)}
      {job ? <div className={`lm-log-group is-${job.outcome ? (job.outcome.ok ? "done" : "failed") : "working"}`}>
        <p className="lm-log-head">{t(jobLabelKey(job.mode))}{job.outcome ? "" : ` · ${Math.floor(job.progress?.percent ?? 0)} %`}</p>
        {events.map((event, index) => <p key={index} className={`is-${event.kind}`}>{eventText(event, job, t)}</p>)}
        {job.outcome ? <p className="lm-log-foot">{job.outcome.detail}</p> : null}
      </div> : null}
      {download ? <DownloadLog snapshot={download.snapshot} /> : null}
    </div>
  );
}

/** The game's log lines a download writes (pipeline.py): shown as the download's groups while it runs. */
const DOWNLOAD_LOG_STEPS = ["descarga", "estado", "espacio", "descompresión"];

/** A "freeze" line of the game's log written since `since` (ms): it belongs to the freeze group shown live. */
function isFreezeLineSince(line: string, since: number): boolean {
  const [stamp, step] = line.split(" | ");
  const at = new Date((stamp ?? "").replace(" ", "T")).getTime();
  return step?.trim() === "freeze" && !Number.isNaN(at) && at >= since;
}

/** One notice per Library Manager action, saying how many games it changed and how many failed. */
function announceBatch(action: BatchAction, results: Array<{ app_id: number; ok: boolean; error?: string }>, games: LibraryGame[]): void {
  if (!results.length) return;
  const ok = results.filter(row => row.ok).length;
  const failed = results.length - ok;
  if (action === "discard_transfer" || action === "linked_delete" || action === "linked_move") {
    const row = results[0];
    const name = games.find(game => game.app_id === row.app_id)?.name ?? `#${row.app_id}`;
    const done = action === "discard_transfer" ? "toastTransferDiscarded" : action === "linked_delete" ? "toastLinkedDeleted" : "toastLinkedMoved";
    if (row.ok) notify(translate(done, { name }), { tone: "success" });
    else notify(translate("toastActionFailed", { error: row.error || name }), { tone: "error" });
    return;
  }
  const summary = translate(action === "adopt" ? "toastLibraryFixed" : "toastLibraryUninstalled", { ok });
  notify(failed ? translate("toastBatchFailures", { summary, failed }) : summary, { tone: !failed ? "success" : ok ? "warning" : "error" });
}

type BatchAction = "adopt" | "uninstall" | "steam_uninstall" | "discard_transfer" | "linked_delete" | "linked_move";

/** One line of the grid, a game with a folder or a member of the library without one, with the values it sorts by. */
type GridRow = { key: string; name: string; status: Status; path: string; size: number; kind: Kind; source: string; plays: number; idle: number | null; game?: LibraryGame; member?: CatalogGame; download?: DownloadEntry };
type SortKey = "name" | "status" | "path" | "size" | "kind" | "plays" | "idle";
type Sort = { key: SortKey; dir: 1 | -1 };
/** Numbers start from the largest, words from A. */
const firstDir = (key: SortKey): 1 | -1 => key === "size" || key === "plays" || key === "idle" ? -1 : 1;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const compareRows = ({ key, dir }: Sort) => (a: GridRow, b: GridRow) => {
  // A row with no folder or no day count goes last in both directions.
  if (key === "path" && !a.path !== !b.path) return a.path ? -1 : 1;
  if (key === "idle" && (a.idle == null) !== (b.idle == null)) return a.idle == null ? 1 : -1;
  const order = key === "status" ? a.status.rank - b.status.rank
    : key === "size" || key === "plays" ? a[key] - b[key]
    : key === "idle" ? (a.idle ?? 0) - (b.idle ?? 0)
    : key === "kind" ? collator.compare(a.kind, b.kind) || collator.compare(a.source, b.source)
    : collator.compare(a[key], b[key]);
  return order * dir || collator.compare(a.name, b.name);
};
/** The size the row shows (SizeCell): on disk when frozen, what was downloaded for an unfinished download. */
const sizeOf = (game: LibraryGame) => game.frozen && game.frozen_bytes != null ? game.frozen_bytes : game.partial ? game.transfer_bytes ?? 0 : game.size_bytes ?? 0;
/** Whole days without playing: since the last play, or since the game came into the library when it was never played. */
export const idleDays = (game: Pick<LibraryGame, "last_played" | "added_at">, now = Date.now()) => {
  const value = game.last_played || game.added_at;
  const date = value ? new Date(value.replace(" ", "T")) : null;
  return date && !Number.isNaN(date.getTime()) ? Math.max(0, Math.floor((now - date.getTime()) / 86_400_000)) : null;
};

type RowProps = {
  row: GridRow; game: LibraryGame; c: LibraryCopy; busy: boolean; largest: number; focusId: number | null; locale: string; columns: number;
  expanded: number | null; setExpanded: (id: number | null) => void;
  verify: (game: LibraryGame) => void; verdict: (game: LibraryGame) => RunCheck | null | undefined; verifying: number | null;
  selection: Selection; setSelection: (update: (current: Selection) => Selection) => void;
  findCatalogGame: (game: LibraryGame) => CatalogGame | undefined;
  onInstall?: (game: CatalogGame) => void; onPlay?: (game: CatalogGame) => void | Promise<void>;
  askPlan: (ids: number[]) => Promise<void>; setPending: (pending: Pending) => void; setThawing: (game: LibraryGame, mode: FreezeMode) => void;
  retry: (id: number) => void; configure: (game: LibraryGame) => void;
  /** The game's download, while it has not ended (its detail shows in the row). */
  downloadOf: (id: number | null | undefined) => DownloadEntry | undefined; queueLength: number;
};

/** "Language and launch" (executable, arguments, administrator, automation), as in the game's menu: for any game whose
 *  folder Game Access runs (not Steam's, nor one whose files sit in the deep-freeze archive). */
const configurable = (game: LibraryGame) => game.app_id != null && kindOf(game) !== "steam" && !game.partial && game.frozen !== "deep";

/** The source (DD, Steam, folder) and, next to it, the provider of the download or the Steam account that owns it. */
function KindCell({ kind, source }: { kind: Kind; source: string }) {
  const { t } = useI18n();
  const [label, title] = kindLabels[kind];
  return <span className="lm-source"><span className={`lm-kind ${kind}`} title={title ? t(title) : undefined}>{t(label)}</span>{source ? <span className="lm-source-name" title={source}>{source}</span> : null}</span>;
}

/** Games the library manager can try to run: installed or linked, not deep frozen, not a download in progress. */
const canVerify = (game: LibraryGame) => game.app_id != null && game.installed && game.frozen !== "deep" && !game.partial && !isUnfinished(game) && !isSteamOwned(game);

function RunBadge({ check, running, c }: { check: RunCheck | null | undefined; running: boolean; c: LibraryCopy }) {
  if (running) return <span className="lm-status busy lm-runcheck"><Loader2 className="animate-spin" />{c.verify}…</span>;
  if (!check) return null;
  const when = check.at.replace("T", " ").slice(0, 16);
  return check.state === "checked"
    ? <span className="lm-status ok lm-runcheck" title={c.checkedTip(when)}><ShieldCheck />{c.checkedBadge}</span>
    : <span className="lm-status bad lm-runcheck" title={c.cantRunTip(check.detail, when)}><ShieldAlert />{c.cantRunBadge}</span>;
}

function StatusCell({ status }: { status: Status }) {
  return <span className={`lm-status ${status.tone}`}>{status.icon}{status.label}</span>;
}

/** A row of the grid: picture, name, state, folder, size, source, plays, days without playing and the row's actions.
 *  What a game still needs, or a problem it has, is in its log (the expanded row). */
/** The child's list changed: the change waits in a notice until it is applied (one Windows permission). */
function offerKidApply(c: LibraryCopy) {
  showNotice({ tone: "info", title: c.kidPending, timer: false, actions: [
    { label: c.kidApplyNow, kind: "primary", run: () => { hideNotice(); void applyKidDraft().then(() => notify(c.kidApplied), failure => notify(translate("toastActionFailed", { error: String(failure instanceof Error ? failure.message : failure) }), { tone: "error" })); } },
    { label: c.kidLater, kind: "secondary", run: () => hideNotice() },
  ] });
}

/** Removes a shortcut; when the child has it, the confirmation says it also leaves their list. */
async function removeForKid(item: AppShortcut, c: LibraryCopy) {
  const kidGames = kidGamesAmong([-item.id]);
  if (kidGames.length) {
    const ok = await confirmNotice({ title: c.appsRemove, text: c.kidRemoveNote(kidGames.map(game => game.name).join(", "), kidGames.length >= kidGameCount()), confirmLabel: c.appsRemove, cancelLabel: c.cancel });
    if (!ok) return;
  }
  await removeShortcut(item.id);
  if (dropKidGames([-item.id]).length) offerKidApply(c);
}

/** Shortcuts to programs that are not library games (appShortcuts.ts): their own section under the games, never
 *  matched to Steam nor moved into the games folder. */
function ThirdPartyApps({ c }: { c: LibraryCopy }) {
  const shortcuts = useShortcuts();
  useEffect(() => { void loadShortcuts(); }, []);
  const fail = (failure: unknown) => notify(c.appsFailed.replace("{error}", String(failure instanceof Error ? failure.message : failure)), { tone: "error" });
  return <section className="lm-apps" aria-labelledby="lm-apps-title">
    <header><div><h3 id="lm-apps-title">{c.appsTitle}</h3><p>{c.appsHint}</p></div>
      <GaButton icon={<AppWindow size={16} aria-hidden="true" />} disabled={libraryDemo()} onClick={() => void addShortcut(c.appsFilter).catch(fail)}>{c.appsAdd}</GaButton></header>
    {shortcuts.length ? <ul>
      {shortcuts.map(item => <li key={item.id}>
        <AppWindow size={18} aria-hidden="true" /><span className="lm-apps-name">{item.name}</span><span className="lm-apps-path" title={item.target}>{item.target}</span>
        <span className="lm-acts">
          <IconAction label={c.appsOpen} onClick={() => void openShortcut(item.id).catch(fail)}><PhPlay /></IconAction>
          <IconAction label={c.appsRemove} tone="danger" onClick={() => void removeForKid(item, c).catch(fail)}><Trash /></IconAction>
        </span>
      </li>)}
    </ul> : <p className="lm-empty">{c.appsEmpty}</p>}
  </section>;
}

function ManagerRow({ row, game, c, busy, largest, focusId, columns, expanded, setExpanded, verify, verdict, verifying, selection, setSelection, findCatalogGame, onInstall, onPlay, askPlan, setPending, setThawing, retry, configure, downloadOf, queueLength }: RowProps) {
  const id = game.app_id;
  const key = row.key;
  const open = expanded === id;
  const catalogGame = findCatalogGame(game);
  const unfinished = game.partial || isUnfinished(game);
  const ref = useRef<HTMLTableRowElement>(null);
  const focused = focusId != null && focusId === id;
  // A freeze or thaw of this game shows in its row: in the game's log and as its picture freezing (and not in the
  // floating console meanwhile). Once ended, it goes when the row does.
  const job = useFreezeJobView(id);
  // Waiting in the queue, the row only says so; working (or just ended) it shows the log and the freeze bar.
  const freezing = job && !job.queued ? job : undefined;
  const busyFreezing = Boolean(job && !job.outcome);
  // A download of this game shows its detail in the row, open, while it lasts (Seba, 2026-11-01).
  const download = downloadOf(id);
  const unfolded = open || Boolean(freezing) || Boolean(download);
  const downloadView = useDownloadView(download, activeDownloadService());
  const hosted = Boolean(freezing) && id != null;
  useEffect(() => {
    if (!hosted || id == null) return undefined;
    const release = hostFreezeJob(id);
    return () => { release(); if (!freezeJob(id)) dismissFreezeJob(id); };
  }, [hosted, id]);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focused]);
  const [menu, setMenu] = useState<MenuAt>(null);
  const failed = (failure: unknown) => notify(translate("toastActionFailed", { error: String(failure instanceof Error ? failure.message : failure) }), { tone: "error" });
  const openDownloadFolder = act(c.openDownloadFolder, <PhFolderOpen />, () => void digitalProcessManager.openFolder(asGame(game), "download"), { disabled: libraryDemo() });
  // What the game offers, by its state (the same list in the open row and in the context menu).
  const actions: RowAction[] = busyFreezing && job
    // While it is frozen, thawed or waiting for that, the game only offers to cancel it (nothing else touches it).
    ? [act(job.cancelling ? translate("freezeCancelling") : translate(jobCancelKey(job.mode)), <X size={16} />, () => cancelFreezeJob(job.appId), { tone: "danger", disabled: Boolean(job.cancelling) })]
    : unfinished && !game.transfer_active ? [
      // A stopped download goes on from the step it reached, through the Download Manager (no plugin needed);
      // without one, the transfer starts again from the catalog.
      game.resume_step
        ? act(game.resume_step === "extract" ? c.resumeExtract : c.resumeDownload, <PhPlay />, () => void digitalDownloadService.retry(catalogGame ?? asGame(game)).then(() => scanLibrary(), failed), { tone: "accent", disabled: busy })
        : act(!catalogGame ? c.cannotResume : game.transfer_kind === "pieces" ? c.resumePieces : c.resumeOther, <PhPlay />, () => { if (catalogGame) onInstall?.(catalogGame); }, { tone: "accent", disabled: !catalogGame || busy }),
      ...(game.partial ? [act(c.restart, <ArrowCounterClockwise />, () => setPending({ kind: "discard", game, restart: true }), { disabled: busy })] : []),
      ...(configurable(game) ? [act(c.options, <GearSix />, () => configure(game), { disabled: busy })] : []),
      openDownloadFolder,
      act(c.discardAll, <Trash />, () => setPending({ kind: "discard", game, restart: false }), { tone: "danger", disabled: busy }),
    ] : game.partial || game.transfer_active ? [openDownloadFolder] : [
      ...(game.installed && game.frozen !== "deep" && catalogGame && onPlay ? [act(c.play, <PhPlay />, () => void onPlay(catalogGame), { tone: "accent", disabled: busy })] : []),
      ...(isSteamOwned(game) ? [act(translate("steamInstallMenu"), <DownloadSimple />, () => onInstall?.(catalogGame ?? asGame(game)), { tone: "accent", disabled: busy })] : []),
      // A folder that ended in ERROR (an installer that failed, say) is processed again straight away: unpacked,
      // installed and checked, as Fix does, after any change made in "Language and launch".
      ...(retryable(game) && id != null ? [act(c.retryProcess, <ArrowClockwise />, () => retry(id), { tone: "accent", disabled: busy })]
        : needsFix(game) && id != null ? [act(c.fix, <MagicWand />, () => void askPlan([id]), { tone: "accent", disabled: busy })] : []),
      ...(canVerify(game) ? [act(c.verify, verifying === id ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />, () => verify(game), { disabled: busy || verifying != null })] : []),
      ...(configurable(game) ? [act(c.options, <GearSix />, () => configure(game), { disabled: busy })] : []),
      act(c.openFolder, <PhFolderOpen />, () => void digitalProcessManager.openFolder(asGame(game)), { disabled: libraryDemo() || isSteamOwned(game) }),
      ...(game.frozen && !game.linked && id != null ? [act(c.thaw, <PhFlame />, () => setThawing(game, "thaw"), { tone: "frost", disabled: busy })] : []),
      ...(!game.frozen && !game.linked && game.installed && id != null ? [
        act(c.freeze, <PhSnowflake />, () => setThawing(game, "freeze"), { tone: "frost", disabled: busy }),
        act(c.deepFrozen, <PhSnowflake />, () => setThawing(game, "deep"), { tone: "frost", disabled: busy }),
      ] : []),
      // A move cut short (the app or the PC went off): it goes on from what it copied, or that copy is deleted.
      // A game linked from a folder of the player's: moved into the games folder or deleted from disk with its folder.
      ...(game.move_pending && id != null ? [
        act(translate("moveResume"), <ArrowSquareIn />, () => startFreezeJob(catalogGame ?? asGame(game), "move", { resume: true }), { tone: "accent", disabled: busy }),
        act(translate("moveDiscard"), <Trash />, () => void confirmNotice({ title: translate("moveDiscardTitle", { name: game.name }), text: translate("moveDiscardText"), confirmLabel: translate("moveDiscard"), cancelLabel: c.cancel, kind: "danger" }).then(ok => { if (ok) { hideNotice(); void discardMove(catalogGame ?? asGame(game)); } }), { tone: "danger", disabled: busy }),
      ] : game.link_kind === "folder" && game.installed && id != null ? [
        act(c.linkedMove, <ArrowSquareIn />, () => setPending({ kind: "linked_move", game }), { tone: "accent", disabled: busy }),
        act(c.linkedDelete, <Trash />, () => setPending({ kind: "linked_delete", game }), { tone: "danger", disabled: busy }),
      ] : []),
      // A Steam game can also be deleted from disk, as Steam's own Uninstall does (no Steam account involved).
      ...(game.link_kind === "steam" && game.installed && !isSteamOwned(game) ? [act(c.steamUninstall, <Trash />, () => setPending({ kind: "steam_uninstall", game }), { tone: "danger", disabled: busy || id == null })] : []),
      act(game.linked ? c.unlink : c.uninstall, game.linked ? <LinkBreak /> : <Trash />, () => { if (id != null) setPending({ kind: "uninstall", ids: [id] }); }, { tone: "danger", disabled: busy || id == null }),
    ];
  // The context menu also opens and closes the row; the open row shows the rest beside its log.
  const history = act(open ? c.historyHide : c.history, <Scroll />, () => setExpanded(open ? null : id));
  return (<>
    <tr ref={ref} className={`lm-row is-openable${focused ? " is-focus" : ""}${selection[key] ? " is-selected" : ""}${unfolded ? " is-expanded" : ""}`} data-app-id={id ?? undefined}
      aria-expanded={unfolded} onClick={event => { if (!onControl(event) && id != null && !download && !freezing) setExpanded(open ? null : id); }}
      onContextMenu={event => { event.preventDefault(); setMenu(menuAt(event)); }}>
      <td className="lm-cell-check">{id != null ? <input type="checkbox" className="lm-check" tabIndex={-1} aria-label={game.name} checked={Boolean(selection[key])} onChange={event => { const value = event.target.checked; setSelection(current => ({ ...current, [key]: value })); }} /> : null}</td>
      <td>{unfolded ? null : <span className={`lm-thumb${game.frozen ? " is-frozen" : ""}`}>{id ? <GameWideArt game={{ app_id: id, name: game.name }} compact /> : <ArtworkFallback name={game.name} compact />}</span>}</td>
      <td className="lm-cell-name">
        <div className="lm-name" title={game.name}>{game.name}</div>
      </td>
      <td><StatusCell status={busyFreezing && job ? freezeStatus(job, translate) : download ? downloadStatus(download) : row.status} /><RunBadge check={verdict(game)} running={verifying === id} c={c} /></td>
      <td className="lm-cell-path" title={row.path}>{row.path || "—"}</td>
      <td className="lm-cell-size"><SizeCell game={game} largest={largest} c={c} /></td>
      <td><KindCell kind={row.kind} source={row.source} /></td>
      <td className="lm-cell-num">{row.plays || "—"}</td>
      <td className="lm-cell-num">{row.idle ?? "—"}</td>
      <td className="lm-acts"><IconAction label={c.moreActions} pressed={Boolean(menu)} onClick={event => setMenu(menuAt(event))}><DotsThree weight="bold" /></IconAction></td>
    </tr>
    {unfolded ? <tr className="lm-detail-row"><td colSpan={columns}><div className="lm-detail">
      <RowExpand logTitle={c.historyTitle}
        log={<>
          {game.issues.length && (!game.unfinished || game.stalled) && !download ? <div className="lm-needs"><b>{c.whatNeeds}</b>
            <ul>{game.issues.map(issue => <li key={issue.code}><AlertTriangle />{issue.message}{issue.bytes ? <em>({formatBytes(issue.bytes)})</em> : null}</li>)}</ul></div> : null}
          <History game={game} c={c} job={freezing} download={download} />
        </>}
        {...(downloadView ?? (freezing && id ? jobView(freezing, id, translate) : { art: id ? <GameWideArt game={{ app_id: id, name: game.name }} className={`lm-expand-still${game.frozen ? " is-frozen" : ""}`} lazy={false} /> : null }))} />
    </div></td></tr> : null}
    {menu ? <RowMenu at={menu} title={game.name} actions={busyFreezing || download ? actions : [history, ...actions]} onClose={() => setMenu(null)} /> : null}
  </>);
}

/** A freeze, thaw or move in the open row's cells: its animation over the picture, its figures and cancel. */
function jobView(job: FreezeJob, id: number, tr: typeof translate) {
  const progress = job.outcome?.cancelled ? 0 : job.outcome?.ok ? 100 : job.progress?.percent ?? 0;
  const state = job.outcome ? (job.outcome.ok || job.outcome.cancelled ? "done" : "failed") : "working";
  const { speed, eta } = jobStats(job.progress);
  const p = job.progress;
  return {
    artTitle: tr(jobLabelKey(job.mode)),
    art: job.mode === "move"
      ? <MoveArt game={job.game} percent={progress} state={state} size={moveLeft(p, job.outcome ? "done" : "working")} />
      : <FreezeBar game={job.game} mode={job.mode as FreezeMode} percent={progress} state={state} size={freezeSize(p)} />,
    progress,
    // Values only, at the picture's base (the percentage is the ring over it).
    stats: [
      { label: tr("rowProcessed"), value: p?.total_bytes ? `${formatBytes(p.done_bytes)} / ${formatBytes(p.total_bytes)}` : "—" },
      { label: tr("downloadsRemaining"), value: eta ? clock(eta) : "—" },
      { label: tr("downloadsSpeed"), value: speed ? `${formatBytes(speed)}/s` : "—" },
    ],
    actions: job.outcome ? [] : [{ label: job.cancelling ? tr("freezeCancelling") : tr(jobCancelKey(job.mode)), icon: <X size={14} aria-hidden="true" />, tone: "danger" as const, disabled: Boolean(job.cancelling), onClick: () => cancelFreezeJob(job.appId) }],
  };
}

/** A download's state as the grid shows it: first in the grid sorted by state. */
function downloadStatus(entry: DownloadEntry): Status {
  return { rank: 0, label: downloadPhaseLabel(entry.snapshot.phase), tone: ["error", "interrupted"].includes(entry.snapshot.phase) ? "warn" : "busy" };
}

/** A game being downloaded that has no folder in the library yet (just asked for in the catalog): the row and the
 *  download's detail under it. */
function DownloadRow({ row, entry, columns, c }: { row: GridRow; entry: DownloadEntry; columns: number; c: LibraryCopy }) {
  const appId = entry.game.app_id ?? entry.snapshot.gameId;
  const view = useDownloadView(entry, activeDownloadService());
  return (<>
    <tr className="lm-row is-expanded" data-app-id={appId}>
      <td className="lm-cell-check" />
      <td />
      <td className="lm-cell-name"><div className="lm-name" title={entry.game.name}>{entry.game.name}</div></td>
      <td><StatusCell status={row.status} /></td>
      <td className="lm-cell-path">—</td>
      <td className="lm-cell-size">—</td>
      <td><KindCell kind={row.kind} source="" /></td>
      <td className="lm-cell-num">—</td>
      <td className="lm-cell-num">—</td>
      <td className="lm-acts" />
    </tr>
    <tr className="lm-detail-row"><td colSpan={columns}><div className="lm-detail">{view ? <RowExpand logTitle={c.historyTitle} log={<History c={c} download={entry} />} {...view} /> : null}</div></td></tr>
  </>);
}

/** A game of the library with no folder yet: Install, or take it out of the library. */
function AbsentRow({ row, game, c, onInstall }: { row: GridRow; game: CatalogGame; c: LibraryCopy; onInstall?: (game: CatalogGame) => void }) {
  const [menu, setMenu] = useState<MenuAt>(null);
  const actions = [
    ...(onInstall ? [act(c.install, <DownloadSimple />, () => onInstall(game), { tone: "accent" })] : []),
    act(c.unlink, <LinkBreak />, () => libraryMembership.remove(game), { tone: "danger" }),
  ];
  return (<>
    <tr className="lm-row" onContextMenu={event => { event.preventDefault(); setMenu(menuAt(event)); }}>
      <td className="lm-cell-check" />
      <td><span className="lm-thumb">{game.app_id ? <GameWideArt game={game} compact /> : null}</span></td>
      <td className="lm-cell-name"><div className="lm-name" title={game.name}>{game.name}</div></td>
      <td><StatusCell status={row.status} /></td>
      <td className="lm-cell-path">—</td>
      <td className="lm-cell-size">—</td>
      <td><KindCell kind={row.kind} source="" /></td>
      <td className="lm-cell-num">—</td>
      <td className="lm-cell-num">—</td>
      <td className="lm-acts"><IconAction label={c.moreActions} pressed={Boolean(menu)} onClick={event => setMenu(menuAt(event))}><DotsThree weight="bold" /></IconAction></td>
    </tr>
    {menu ? <RowMenu at={menu} title={game.name} actions={actions} onClose={() => setMenu(null)} /> : null}
  </>);
}

/** The downloads that have not ended (stopped ones too, to go on), by app id, kept up to date. */
function useManagerDownloads(): Map<number, DownloadEntry> {
  const read = () => new Map(activeDownloadService().getDownloads()
    .filter(entry => !["completed", "cancelled", "external"].includes(entry.snapshot.phase))
    .map(entry => [entry.game.app_id ?? entry.snapshot.gameId, entry] as const));
  const [downloads, setDownloads] = useState(read);
  useEffect(() => activeDownloadService().onGlobalUpdate(() => setDownloads(read())), []); // eslint-disable-line react-hooks/exhaustive-deps
  return downloads;
}

/** A column header that sorts: one click sorts, the next one reverses; the arrow says which way. */
function SortHeader({ id, label, title, sort, setSort, t }: { id: SortKey; label: string; title?: string; sort: Sort; setSort: (sort: Sort) => void; t: Translate }) {
  const active = sort.key === id;
  const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className={`lm-sort${active ? " is-active" : ""}`} title={title ? `${title}. ${t("lmSortBy", { column: label })}` : t("lmSortBy", { column: label })}
        onClick={() => setSort(active ? { key: id, dir: sort.dir === 1 ? -1 : 1 } : { key: id, dir: firstDir(id) })}>
        {label}<Icon aria-hidden="true" />
      </button>
    </th>
  );
}

export default function GameLibraryManager({ onClose, catalog = [], onInstall, onPlay, focusAppId, embedded = false, query = "", scrollRef, startImport = false, onImportStarted }: {
  onClose: () => void;
  /** Opened from the empty library's "Import": the import starts at once (after the parent's key, as its button). */
  startImport?: boolean; onImportStarted?: () => void; catalog?: CatalogGame[]; onInstall?: (game: CatalogGame) => void; onPlay?: (game: CatalogGame) => void | Promise<void>;
  /** Highlights this game's row and scrolls to it ("Manage" on the back of a library card). */
  focusAppId?: number | null;
  /** Inside a desk panel (T10): the panel draws the title and the close button and handles Esc. */
  embedded?: boolean;
  /** The catalog and library search (one search box for the whole app): it filters the manager's games too. */
  query?: string;
  /** The box that scrolls the games' rows (the header, summary, buttons and filters stay put): the app's round
   *  scrollbar drives it. */
  scrollRef?: RefObject<HTMLDivElement>;
}) {
  const { locale, t } = useI18n(); const c = copy[locale] ?? copy.es;
  const { games, summary, scanning, error } = useLibraryScan();
  useEffect(() => { void loadKidFamily(); }, []);
  const members = useLibraryGames();
  const downloads = useManagerDownloads();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>({ key: "size", dir: -1 });
  const [selection, setSelection] = useState<Selection>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // "Does it run here?": one game, or every installed and linked one in turn (stoppable between games).
  const [verdicts, setVerdicts] = useState<Record<number, RunCheck>>({});
  const [verifying, setVerifying] = useState<{ id: number | null; done: number; total: number; name: string } | null>(null);
  const stopVerify = useRef(false);
  const [message, setMessage] = useState("");
  const [freezing, setFreezing] = useState<{ game: LibraryGame; mode: FreezeMode } | null>(null);
  const [configuring, setConfiguring] = useState<LibraryGame | null>(null);
  useEffect(() => { void scanLibrary(); }, []);
  useEffect(() => {
    if (!startImport) return;
    onImportStarted?.();
    setImportOpen(true);
  }, [startImport]); // eslint-disable-line react-hooks/exhaustive-deps
  // Games just added (imported, linked from Steam) have never been tried: the manager offers to check them (a notice, never on its own).
  const knownBefore = useRef<Set<number>>(new Set());
  const rememberKnown = () => { knownBefore.current = new Set(games.map(game => game.app_id).filter((id): id is number => id != null)); };
  const suggestVerify = async () => {
    await scanLibrary();
    const fresh = libraryScanState().games.filter(game => game.app_id != null && !knownBefore.current.has(game.app_id) && !game.run_check && canVerify(game));
    if (!fresh.length) return;
    showNotice({ tone: "info", title: c.verifySuggestTitle(fresh.length), text: c.verifyNote, timer: false, actions: [
      { label: c.verifySuggestYes, kind: "primary", run: () => { hideNotice(); void verifyGames(fresh); } },
      { label: c.verifyLater, kind: "secondary", run: () => hideNotice() },
    ] });
  };
  const importSteam = async () => {
    setBusy(true);
    rememberKnown();
    try {
      const result = await syncSteamLibrary(catalog, { refresh: true });
      notify(result.found ? t("steamImported", { linked: result.linked.length, owned: result.owned.length }) : t("steamNotFound"), { tone: result.found ? "success" : "error" });
      notifyLibraryChanged();
      if (result.found) void suggestVerify();
    } catch (failure) { notify(translate("toastActionFailed", { error: String(failure) }), { tone: "error" }); } finally { setBusy(false); }
  };
  useEffect(() => { if (focusAppId != null) setFilter("all"); }, [focusAppId]);
  // Every word of the search in the name, without accents or case, as in the catalog; the game "Manage" opened stays.
  const terms = useMemo(() => normalizeSearchText(query.trim()).split(/\s+/).filter(Boolean), [query]);
  const matches = (name: string, appId?: number | null) => !terms.length || (focusAppId != null && appId === focusAppId) || terms.every(term => normalizeSearchText(name).includes(term));

  const counts = useMemo(() => ({ all: games.length, outside: games.filter(needsFix).length, errors: games.filter(hasError).length, partial: games.filter(isUnfinished).length, frozen: games.filter(game => game.frozen).length }), [games]);
  const rows = useMemo(() => games.filter(game => {
    if (!matches(game.name, game.app_id)) return false;
    return filter === "all" || (filter === "outside" && needsFix(game)) || (filter === "errors" && hasError(game)) || (filter === "partial" && isUnfinished(game)) || (filter === "frozen" && Boolean(game.frozen));
  }), [games, filter, terms, focusAppId]); // eslint-disable-line react-hooks/exhaustive-deps
  const largest = useMemo(() => Math.max(1, ...games.map(game => game.original_bytes ?? game.size_bytes ?? 0)), [games]);
  const selectedIds = useMemo(() => rows.filter(game => game.app_id != null && selection[String(game.app_id)]).map(game => game.app_id as number), [rows, selection]);
  const fixable = useMemo(() => games.filter(needsFix).map(game => game.app_id as number), [games]);
  const selectedFixable = selectedIds.filter(id => fixable.includes(id));

  const verifyGames = async (list: LibraryGame[]) => {
    const queue = list.filter(canVerify);
    if (!queue.length || verifying || libraryDemo()) return;
    stopVerify.current = false;
    let ok = 0, bad = 0, skipped = 0;
    for (let index = 0; index < queue.length && !stopVerify.current; index++) {
      const game = queue[index];
      setVerifying({ id: game.app_id, done: index, total: queue.length, name: game.name });
      try {
        const result = await digitalProcessManager.verifyRun(asGame(game));
        if (result.skipped || !result.check) skipped++;
        else { setVerdicts(current => ({ ...current, [game.app_id as number]: result.check as RunCheck })); if (result.check.state === "checked") ok++; else bad++; }
      } catch (failure) { bad++; setVerdicts(current => ({ ...current, [game.app_id as number]: { state: "cantRun", at: new Date().toISOString(), detail: String(failure instanceof Error ? failure.message : failure) } })); }
    }
    setVerifying(null);
    notify(c.verifyDone(ok, bad, skipped), { tone: bad ? "warning" : "success", activity: { kind: "verify", merge: "replace", title: translate("activityVerifyTitle"), text: c.verifyDone(ok, bad, skipped) } });
    void scanLibrary();
  };
  const verdict = (game: LibraryGame) => (game.app_id != null ? verdicts[game.app_id] : undefined) ?? game.run_check;

  const findCatalogGame = (game: LibraryGame) => catalog.find(item => (item.app_id ?? item.id) === game.app_id) ?? members.find(item => (item.app_id ?? item.id) === game.app_id);

  const askPlan = async (ids: number[]) => {
    if (!ids.length) return;
    setBusy(true); setMessage("");
    try {
      const plans = libraryDemo() ? demoPlans(ids) : (await digitalProcessManager.libraryPlan(ids)).plans ?? [];
      setPending({ kind: "plan", plans, ids });
    } catch (failure) { setMessage(String(failure)); } finally { setBusy(false); }
  };
  const runBatch = async (action: BatchAction, ids: number[]): Promise<number[]> => {
    setBusy(true); setMessage(c.working);
    let worked: number[] = [];
    try {
      const results: Array<{ app_id: number; ok: boolean; error?: string; in_use_folder?: string }> = libraryDemo() ? ids.map(app_id => ({ app_id, ok: true })) : (await digitalProcessManager.libraryBatch(action, ids)).results ?? [];
      if (action === "adopt" && !libraryDemo()) results.forEach(row => { const found = games.find(game => game.app_id === row.app_id); if (row.ok && found) addReadyGameToLibrary(row.app_id, found.name, catalog); });
      worked = results.filter(row => row.ok).map(row => row.app_id);
      setMessage(c.done(results.filter(row => row.ok).length, results.filter(row => !row.ok).length));
      announceBatch(action, results, games);
      // A folder held open by other programs: the notice names them, can close the Explorer windows and tries again.
      const locked = results.find(row => !row.ok && row.in_use_folder);
      if (locked?.in_use_folder) void showFolderInUse(locked.in_use_folder, () => void runBatch(action, [locked.app_id]));
      setSelection({});
    } catch (failure) { setMessage(String(failure)); notify(translate("toastActionFailed", { error: String(failure) }), { tone: "error" }); } finally { setBusy(false); setPending(null); await scanLibrary(); notifyLibraryChanged(); }
    return worked;
  };
  /** Games that left the library also leave the child's list; the change waits for "Apply". */
  const releaseKidGames = (ids: number[]) => { if (dropKidGames(ids).length) offerKidApply(c); };
  const confirmPending = async (current: Pending | null = pending) => {
    if (!current) return;
    if (current.kind === "plan") await runBatch("adopt", current.ids);
    else if (current.kind === "uninstall") releaseKidGames(await runBatch("uninstall", current.ids));
    else if (current.kind === "steam_uninstall") releaseKidGames(await runBatch("steam_uninstall", [current.game.app_id as number]));
    else if (current.kind === "linked_delete") releaseKidGames(await runBatch(current.kind, [current.game.app_id as number]));
    else if (current.kind === "linked_move") {
      // Minutes of disk when it goes to another disk: a job like a freeze (freezeJobs.ts), shown in the game's row
      // with its log and bar, cancellable, told in the notice when it ends. The confirmation goes at once.
      const id = current.game.app_id as number;
      hideNotice();
      setPending(null);
      void startFreezeJob(findCatalogGame(current.game) ?? asGame(current.game), "move").done.then(outcome => {
        if (outcome.ok) releaseKidGames([id]);
        notifyLibraryChanged();
      });
    }
    else {
      const catalogGame = findCatalogGame(current.game);
      await runBatch("discard_transfer", [current.game.app_id as number]);
      if (current.restart && catalogGame && onInstall) onInstall(catalogGame);
    }
  };

  // Uninstall and discard ask in the app's single notice (T3), not in a dialog of their own.
  useEffect(() => {
    if (!pending || pending.kind === "plan") return;
    const linkedIds = new Set(games.filter(game => game.linked).map(game => game.app_id));
    const one = pending.kind === "uninstall" && pending.ids.length === 1 ? games.find(game => game.app_id === pending.ids[0]) : pending.kind !== "uninstall" ? pending.game : undefined;
    const allLinked = pending.kind === "uninstall" && pending.ids.every(id => linkedIds.has(id));
    const anyLinked = pending.kind === "uninstall" && pending.ids.some(id => linkedIds.has(id));
    let live = true;
    const leaving = pending.kind === "uninstall" ? pending.ids : pending.kind === "steam_uninstall" || pending.kind === "linked_delete" || pending.kind === "linked_move" ? [pending.game.app_id as number] : [];
    const kidGames = kidGamesAmong(leaving);
    const kidNote = kidGames.length ? ` ${c.kidRemoveNote(kidGames.map(game => game.name).join(", "), kidGames.length >= kidGameCount())}` : "";
    const confirm = () => confirmNotice({
      game: one ? noticeGame(findCatalogGame(one) ?? asGame(one)) : undefined,
      title: pending.kind === "linked_move" ? c.linkedMoveTitle(pending.game.name) : pending.kind === "linked_delete" ? c.linkedDeleteTitle(pending.game.name) : pending.kind === "steam_uninstall" ? c.steamUninstallTitle(pending.game.name) : pending.kind === "uninstall" ? (allLinked ? c.unlinkTitle(pending.ids.length) : c.uninstallTitle(pending.ids.length)) : c.discardTitle,
      text: (pending.kind === "linked_move" ? c.linkedMoveBody(pending.game.folder) : pending.kind === "linked_delete" ? c.linkedDeleteBody(pending.game.folder) : pending.kind === "steam_uninstall" ? c.steamUninstallBody : pending.kind === "uninstall" ? (allLinked ? c.unlinkBody : anyLinked ? `${c.uninstallBody} ${c.unlinkNote}` : c.uninstallBody) : pending.restart ? c.restartBody : c.discardBody) + kidNote,
      confirmLabel: pending.kind === "linked_move" ? c.linkedMove : pending.kind === "linked_delete" ? c.linkedDelete : pending.kind === "steam_uninstall" ? c.uninstall : pending.kind === "uninstall" ? (allLinked ? c.unlink : c.uninstall) : pending.restart ? c.restart : c.discard,
      cancelLabel: c.cancel, kind: pending.kind === "linked_move" ? "primary" : "danger",
    }).then(ok => { if (!live) return; if (ok) void confirmPending(pending); else setPending(null); });
    void confirm();
    return () => { live = false; };
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const [escapeGuard, setEscapeGuard] = useState(false);
  useEffect(() => setEscapeGuard(Boolean(pending) || importOpen || Boolean(freezing) || Boolean(configuring)), [pending, importOpen, freezing, configuring]);
  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !escapeGuard) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escapeGuard, onClose, embedded]);

  const filters: [Filter, string, number][] = ([["all", c.all, counts.all], ["outside", c.outside, counts.outside], ["errors", c.errors, counts.errors], ["partial", c.partial, counts.partial], ["frozen", c.frozenFilter, counts.frozen]] as [Filter, string, number][]).filter(([id, , count]) => id === "all" || id === filter || count > 0);
  const absent = filter === "all" ? members.filter(member => !games.some(game => game.app_id === (member.app_id ?? member.id)) && !downloads.has(member.app_id ?? member.id) && matches(member.name, member.app_id ?? member.id)) : [];
  // Downloads with no folder in the library yet get their own row (in "All" and in "Unfinished downloads").
  const loose = filter === "all" || filter === "partial" ? [...downloads.entries()].filter(([appId, entry]) => !games.some(game => game.app_id === appId) && matches(entry.game.name, appId)) : [];
  const queueLength = [...downloads.values()].filter(entry => entry.snapshot.phase === "queued").length;
  const gridRows: GridRow[] = [
    ...rows.map(game => ({ key: String(game.app_id ?? game.folder), name: game.name, status: statusOf(game, c, t), path: isSteamOwned(game) ? "" : game.folder, size: sizeOf(game), kind: kindOf(game), source: sourceOf(game), plays: game.plays ?? 0, idle: idleDays(game), game })),
    ...absent.map(member => ({ key: `member-${member.app_id ?? member.id}`, name: member.name, status: { rank: 11, label: t("lmStatusNoFolder"), tone: "muted" as const }, path: "", size: 0, kind: "dd" as const, source: "", plays: 0, idle: null, member })),
    ...loose.map(([appId, entry]) => ({ key: `download-${appId}`, name: entry.game.name, status: downloadStatus(entry), path: "", size: 0, kind: "dd" as const, source: "", plays: 0, idle: null, download: entry })),
  ].sort(compareRows(sort));
  const columns = 10;
  const selectable = rows.filter(game => game.app_id != null).map(game => String(game.app_id));
  const allSelected = selectable.length > 0 && selectable.every(key => selection[key]);
  const frozenStored = games.reduce((total, game) => total + (game.frozen ? game.frozen_bytes ?? game.size_bytes ?? 0 : 0), 0);
  const rowProps = { c, busy, locale, columns, expanded, setExpanded, selection, setSelection, largest, findCatalogGame, onInstall, onPlay, askPlan, setPending, setThawing: (game: LibraryGame, mode: FreezeMode) => setFreezing({ game, mode }),
    verify: (game: LibraryGame) => void verifyGames([game]), verdict, verifying: verifying?.id ?? null,
    retry: (id: number) => void runBatch("adopt", [id]), configure: setConfiguring, focusId: focusAppId ?? null,
    downloadOf: (id: number | null | undefined) => id == null ? undefined : downloads.get(id), queueLength };

  return (
    <TooltipProvider delayDuration={150}>
      <div className={embedded ? "lm-root is-embedded" : "lm-root fixed inset-x-0 bottom-0 top-[var(--window-chrome-height,34px)] z-[600] overflow-y-auto bg-background"} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-label={c.title}>
        {embedded ? null : <header className="ga-screen-header !max-w-none"><h2 className="ga-screen-title mr-auto">{c.title}</h2><GaBack label={c.back} onClick={onClose} data-dialog-initial /></header>}
        <div className="lm-content">
          <div className="lm-top">
          {summary ? <section className="lm-summary">
            <DiskDonut summary={summary} frozenBytes={frozenStored} c={c} />
          </section> : null}
          <ActivityBoard scanning={scanning} working={busy} />
          <div className="lm-actions">
            <GaButton variant="primary" icon={<Wand2 size={16} />} disabled={busy || !fixable.length} onClick={() => void askPlan(fixable)}>{c.fixAll} ({fixable.length})</GaButton>
            <GaButton icon={<FolderInput size={16} />} disabled={busy} onClick={() => { rememberKnown(); setImportOpen(true); }}>{c.importGames}</GaButton>
            <GaButton icon={<Gamepad2 size={16} />} disabled={busy} onClick={() => void importSteam()}>{t("steamImportNow")}</GaButton>
            {verifying
              ? <GaButton icon={<X size={16} />} onClick={() => { stopVerify.current = true; }} title={c.verifyNote}>{c.verifyRunning(verifying.done, verifying.total, verifying.name)} · {c.verifyCancel}</GaButton>
              : <GaButton icon={<ShieldCheck size={16} />} disabled={busy} title={c.verifyNote} onClick={() => void verifyGames(games)}>{c.verifyAll} ({games.filter(canVerify).length})</GaButton>}
          </div>
          </div>
          <div className="lm-filters">
            {filters.map(([id, label, count]) => <button key={id} type="button" className="lm-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{count}</span></button>)}
            <GaButton className="lm-icon-button lm-scan" aria-label={scanning ? c.scanning : c.scan} title={scanning ? c.scanning : c.scan} disabled={busy || scanning} onClick={() => void scanLibrary(true)}>{scanning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}</GaButton>
          </div>
          {selectedIds.length ? <div className="lm-selection">
            <b>{c.selected(selectedIds.length)}</b>
            <Button size="sm" variant="default" disabled={busy || !selectedFixable.length} onClick={() => void askPlan(selectedFixable)}><Wand2 />{c.fixSelected}</Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setPending({ kind: "uninstall", ids: selectedIds })}><Trash2 />{c.uninstall}</Button>
            <Button size="icon" variant="ghost" aria-label={c.clear} onClick={() => setSelection({})}><X /></Button>
          </div> : null}
          {message ? <p role="status" className="lm-message">{message}</p> : null}
          {error ? <p role="alert" className="lm-message is-error">{error}</p> : null}
          <div ref={scrollRef} className="lm-grid-wrap">
            {gridRows.length ? <table className="lm-grid">
              <thead><tr>
                <th className="lm-cell-check"><input type="checkbox" className="lm-check" tabIndex={-1} aria-label={t("lmSelectAll")} title={t("lmSelectAll")} checked={allSelected} disabled={!selectable.length} onChange={event => { const value = event.target.checked; setSelection(() => value ? Object.fromEntries(selectable.map(key => [key, true])) : {}); }} /></th>
                <th className="lm-cell-cover"><span className="sr-only">{t("lmColCover")}</span></th>
                <SortHeader id="name" label={t("lmColName")} sort={sort} setSort={setSort} t={t} />
                <SortHeader id="status" label={t("lmColStatus")} sort={sort} setSort={setSort} t={t} />
                <SortHeader id="path" label={t("lmColPath")} sort={sort} setSort={setSort} t={t} />
                <SortHeader id="size" label={t("lmColSize")} sort={sort} setSort={setSort} t={t} />
                <SortHeader id="kind" label={t("lmColKind")} sort={sort} setSort={setSort} t={t} />
                <SortHeader id="plays" label={t("lmColPlays")} sort={sort} setSort={setSort} t={t} />
                <SortHeader id="idle" label={t("lmColIdle")} title={t("lmColIdleTitle")} sort={sort} setSort={setSort} t={t} />
                <th className="lm-cell-acts"><span className="sr-only">{t("lmColActions")}</span></th>
              </tr></thead>
              <tbody>
                {gridRows.map(row => row.game ? <ManagerRow key={row.key} row={row} game={row.game} {...rowProps} /> : row.download ? <DownloadRow key={row.key} row={row} entry={row.download} columns={columns} c={c} /> : row.member ? <AbsentRow key={row.key} row={row} game={row.member} c={c} onInstall={onInstall} /> : null)}
              </tbody>
            </table> : <p className="lm-empty">{games.length || members.length ? c.empty : scanning ? c.scanning : c.noGames}</p>}
            <ThirdPartyApps c={c} />
            <details className="manual-download-entry"><summary>{t("manualDownloadAdd")}</summary><ManualDownloadForm /></details>
          </div>
        </div>
      </div>

      {freezing ? <FreezeDialog game={findCatalogGame(freezing.game) ?? asGame(freezing.game)} mode={freezing.mode} onClose={() => setFreezing(null)} /> : null}
      {configuring ? <DigitalGameOptions game={findCatalogGame(configuring) ?? asGame(configuring)} onClose={() => setConfiguring(null)} /> : null}
      {importOpen ? <ImportWizard catalog={catalog} c={c} onClose={imported => { setImportOpen(false); if (imported) { notifyLibraryChanged(); void suggestVerify(); } }} /> : null}
      {pending?.kind === "plan" ? <PlanDialog plans={pending.plans} c={c} busy={busy} onConfirm={() => void confirmPending()} onCancel={() => setPending(null)} /> : null}
    </TooltipProvider>
  );
}
