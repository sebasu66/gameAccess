import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AlertTriangle, AppWindow, ArrowDown, ArrowUp, ArrowUpDown, Gamepad2, FolderInput, Loader2, RefreshCw, Snowflake, Trash2, Wand2, X } from "lucide-react";
// The row actions use Phosphor's filled icons (lucide only draws lines); the weight comes from the IconContext below.
import { ArrowClockwise, ArrowCounterClockwise, ArrowSquareIn, Baby, DownloadSimple, GearSix, Flame as PhFlame, FolderOpen as PhFolderOpen, IconContext, LinkBreak, MagicWand, Play as PhPlay, Scroll, Snowflake as PhSnowflake, Trash } from "@phosphor-icons/react";
import { translate, useI18n, type TranslationKey } from "../i18n";
import { normalizeSearchText } from "../libraryText";
import { notify } from "../toasts";
import { digitalProcessManager, type LibraryGame, type LibraryPlan } from "../catalog/DigitalProcessManager";
import { libraryDemo, scanLibrary, useLibraryScan } from "../libraryScan";
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
import { cancelFreezeJob, dismissFreezeJob, freezeJob, hostFreezeJob, useFreezeJob, useFreezeJobView, type FreezeJob } from "../freezeJobs";
import { eventText } from "../FreezeConsole";
import { uiDemo } from "../devDemo/uiDemo";
import ActivityBoard from "./ActivityBoard";
import FreezeBar, { freezeSize } from "./FreezeBar";
import { GaBack, GaButton } from "../components/ga/Buttons";
import { confirmNotice, hideNotice, showNotice } from "../notice/notice";
import { applyKidDraft, kidMayPlay, loadKidFamily, toggleKidGame, toggleKidShortcut, useKidState, usePlus } from "../kidMode";
import { addShortcut, loadShortcuts, openShortcut, removeShortcut, useShortcuts, type AppShortcut } from "../appShortcuts";
import { showFolderInUse } from "./folderInUse";
import { noticeGame } from "../notice/noticeGame";
import { isSteamOwned, steamOwnerLabel, syncSteamLibrary } from "../steamLibrary";
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
  return { rank: 0, label: tr(job.mode === "thaw" ? "freezeConsoleThaw" : job.mode === "deep" ? "freezeConsoleDeep" : "freezeConsoleFreeze"), tone: "frost",
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

function IconAction({ label, onClick, disabled, tone, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; tone?: "danger" | "frost" | "accent"; pressed?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={`lm-act${tone ? ` ${tone}` : ""}`} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><IconContext.Provider value={FILLED}>{children}</IconContext.Provider></button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Thaw a frozen game: opens the same dialog as the game menu (it narrates the work, a notice if it is closed). */
function ThawAction({ game, c, disabled, onClick }: { game: LibraryGame; c: LibraryCopy; disabled: boolean; onClick: () => void }) {
  const running = useFreezeJob(game.app_id);
  return <IconAction label={c.thaw} tone="frost" disabled={disabled || Boolean(running)} onClick={onClick}>{running ? <Loader2 className="animate-spin" /> : <PhFlame />}</IconAction>;
}

/** The game's log. A freeze or thaw of the game going on (or just ended) is one group at its end: its title, the
 *  launcher's details indented inside it, and how it ended; the log's own lines of that freeze are left out
 *  meanwhile, so nothing shows twice. When it ends, the log is read again. */
function History({ game, c, job }: { game: LibraryGame; c: LibraryCopy; job?: FreezeJob }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const ended = Boolean(job?.outcome);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    if (libraryDemo() || uiDemo()) { setText("2026-10-12 21:04:11 | importado | carpeta adaptada al estándar actual\n2026-10-12 21:04:12 | analisis | estado=ready; ejecutable=Game/game.exe"); return; }
    void digitalProcessManager.gameLog(asGame(game)).then(result => { if (live) setText(result.log ?? ""); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [game.app_id, ended]);
  const since = job ? job.startedAt - 5000 : null;
  const lines = (text ?? "").split("\n").filter(line => line.trim() && (since == null || !isFreezeLineSince(line, since)));
  const events = (job?.progress?.events ?? []).filter(event => !["start", "done", "failed"].includes(event.kind));
  useEffect(() => { if (job && !job.outcome) box.current?.scrollTo({ top: box.current.scrollHeight }); }, [job, events.length]);
  return (
    <div ref={box} className="lm-history" tabIndex={-1}>
      {text === null ? <p>{c.working}</p> : !lines.length && !job ? <p>{c.noHistory}</p> : lines.map((line, index) => <p key={index}>{line}</p>)}
      {job ? <div className={`lm-log-group is-${job.outcome ? (job.outcome.ok ? "done" : "failed") : "working"}`}>
        <p className="lm-log-head">{t(job.mode === "thaw" ? "freezeConsoleThaw" : job.mode === "deep" ? "freezeConsoleDeep" : "freezeConsoleFreeze")}{job.outcome ? "" : ` · ${Math.floor(job.progress?.percent ?? 0)} %`}</p>
        {events.map((event, index) => <p key={index} className={`is-${event.kind}`}>{eventText(event, job, t)}</p>)}
        {job.outcome ? <p className="lm-log-foot">{job.outcome.detail}</p> : null}
      </div> : null}
    </div>
  );
}

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
type GridRow = { key: string; name: string; status: Status; path: string; size: number; kind: Kind; source: string; plays: number; idle: number | null; game?: LibraryGame; member?: CatalogGame };
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
  selection: Selection; setSelection: (update: (current: Selection) => Selection) => void;
  findCatalogGame: (game: LibraryGame) => CatalogGame | undefined;
  onInstall?: (game: CatalogGame) => void; onPlay?: (game: CatalogGame) => void | Promise<void>;
  askPlan: (ids: number[]) => Promise<void>; setPending: (pending: Pending) => void; setThawing: (game: LibraryGame, mode: FreezeMode) => void;
  retry: (id: number) => void; configure: (game: LibraryGame) => void;
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

function StatusCell({ status }: { status: Status }) {
  return <span className={`lm-status ${status.tone}`}>{status.icon}{status.label}</span>;
}

/** A row of the grid: picture, name, state, folder, size, source, plays, days without playing and the row's actions.
 *  What a game still needs, or a problem it has, is in its log (the expanded row). */
/** Shows or hides a game (or a shortcut) for the child; the change waits in a notice until it is applied (one Windows
 *  permission). */
function chooseForKid(game: LibraryGame | AppShortcut, c: LibraryCopy) {
  if ("app_id" in game) toggleKidGame(game); else toggleKidShortcut(game);
  showNotice({ tone: "info", title: c.kidPending, timer: false, actions: [
    { label: c.kidApplyNow, kind: "primary", run: () => { hideNotice(); void applyKidDraft().then(() => notify(c.kidApplied), failure => notify(translate("toastActionFailed", { error: String(failure instanceof Error ? failure.message : failure) }), { tone: "error" })); } },
    { label: c.kidLater, kind: "secondary", run: () => hideNotice() },
  ] });
}

/** Shortcuts to programs that are not library games (appShortcuts.ts): their own section under the games, never
 *  matched to Steam nor moved into the games folder. */
function ThirdPartyApps({ c }: { c: LibraryCopy }) {
  const shortcuts = useShortcuts();
  const kid = useKidState().draft;
  const plus = usePlus();
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
          {plus && kid.name ? <IconAction label={(kidMayPlay(-item.id) ? c.kidHide : c.kidShow).replace("{name}", kid.name)} tone="accent" pressed={kidMayPlay(-item.id)} onClick={() => chooseForKid(item, c)}><Baby /></IconAction> : null}
          <IconAction label={c.appsRemove} tone="danger" onClick={() => void removeShortcut(item.id).catch(fail)}><Trash /></IconAction>
        </span>
      </li>)}
    </ul> : <p className="lm-empty">{c.appsEmpty}</p>}
  </section>;
}

function ManagerRow({ row, game, c, busy, largest, focusId, columns, expanded, setExpanded, selection, setSelection, findCatalogGame, onInstall, onPlay, askPlan, setPending, setThawing, retry, configure }: RowProps) {
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
  const hosted = Boolean(freezing) && id != null;
  // Kid mode (kidMode.ts): once a child account is set up, each game says whether the child sees it.
  const kid = useKidState().draft;
  const plus = usePlus();
  const forKid = kidMayPlay(id);
  useEffect(() => {
    if (!hosted || id == null) return undefined;
    const release = hostFreezeJob(id);
    return () => { release(); if (!freezeJob(id)) dismissFreezeJob(id); };
  }, [hosted, id]);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focused]);
  return (<>
    <tr ref={ref} className={`lm-row${focused ? " is-focus" : ""}${selection[key] ? " is-selected" : ""}`} data-app-id={id ?? undefined}>
      <td className="lm-cell-check">{id != null ? <input type="checkbox" className="lm-check" tabIndex={-1} aria-label={game.name} checked={Boolean(selection[key])} onChange={event => { const value = event.target.checked; setSelection(current => ({ ...current, [key]: value })); }} /> : null}</td>
      <td><span className={`lm-thumb${game.frozen ? " is-frozen" : ""}`}>{id ? <img src={landscape(id)} alt="" loading="lazy" /> : null}</span></td>
      <td className="lm-cell-name">
        <div className="lm-name" title={game.name}>{game.name}</div>
      </td>
      <td><StatusCell status={busyFreezing && job ? freezeStatus(job, translate) : row.status} /></td>
      <td className="lm-cell-path" title={row.path}>{row.path || "—"}</td>
      <td className="lm-cell-size"><SizeCell game={game} largest={largest} c={c} /></td>
      <td><KindCell kind={row.kind} source={row.source} /></td>
      <td className="lm-cell-num">{row.plays || "—"}</td>
      <td className="lm-cell-num">{row.idle ?? "—"}</td>
      <td className="lm-acts">
        {busyFreezing && job ? <>
          {/* While it is frozen, thawed or waiting for that, the game only offers to cancel it (nothing else touches it). */}
          <IconAction label={job.cancelling ? translate("freezeCancelling") : translate(job.mode === "thaw" ? "thawCancel" : "freezeCancel")} tone="danger"
            disabled={Boolean(job.cancelling)} onClick={() => cancelFreezeJob(job.appId)}><X /></IconAction>
          <IconAction label={c.history} onClick={() => setExpanded(open ? null : id)}><Scroll /></IconAction>
        </> : unfinished && !game.transfer_active ? <>
          {/* A stopped download goes on from the step it reached, through the Download Manager (no plugin needed);
              without one, the transfer starts again from the catalog. */}
          {game.resume_step ? <IconAction label={game.resume_step === "extract" ? c.resumeExtract : c.resumeDownload} tone="accent" disabled={busy} onClick={() => void digitalDownloadService.retry(catalogGame ?? asGame(game)).then(() => scanLibrary(), failure => notify(translate("toastActionFailed", { error: String(failure instanceof Error ? failure.message : failure) }), { tone: "error" }))}><PhPlay /></IconAction>
            : <IconAction label={!catalogGame ? c.cannotResume : game.transfer_kind === "pieces" ? c.resumePieces : c.resumeOther} tone="accent" disabled={!catalogGame || busy} onClick={() => catalogGame && onInstall?.(catalogGame)}><PhPlay /></IconAction>}
          {game.partial ? <IconAction label={c.restart} disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: true })}><ArrowCounterClockwise /></IconAction> : null}
          <IconAction label={c.discardAll} tone="danger" disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: false })}><Trash /></IconAction>
          {configurable(game) ? <IconAction label={c.options} disabled={busy} onClick={() => configure(game)}><GearSix /></IconAction> : null}
          <IconAction label={c.openDownloadFolder} disabled={libraryDemo()} onClick={() => void digitalProcessManager.openFolder(asGame(game), "download")}><PhFolderOpen /></IconAction>
        </> : game.partial || game.transfer_active ? <IconAction label={c.openDownloadFolder} disabled={libraryDemo()} onClick={() => void digitalProcessManager.openFolder(asGame(game), "download")}><PhFolderOpen /></IconAction> : <>
          {isSteamOwned(game) ? <IconAction label={translate("steamInstallMenu")} tone="accent" disabled={busy} onClick={() => onInstall?.(catalogGame ?? asGame(game))}><DownloadSimple /></IconAction> : null}
          {/* A folder that ended in ERROR (an installer that failed, say) is processed again straight away: unpacked,
              installed and checked, as Fix does, after any change made in "Language and launch". */}
          {retryable(game) && id != null ? <IconAction label={c.retryProcess} tone="accent" disabled={busy} onClick={() => retry(id)}><ArrowClockwise /></IconAction>
            : needsFix(game) && id != null ? <IconAction label={c.fix} tone="accent" disabled={busy} onClick={() => void askPlan([id])}><MagicWand /></IconAction> : null}
          {game.installed && game.frozen !== "deep" && catalogGame && onPlay ? <IconAction label={c.play} disabled={busy} onClick={() => void onPlay(catalogGame)}><PhPlay /></IconAction> : null}
          {game.frozen && !game.linked && id != null ? <ThawAction game={game} c={c} disabled={busy} onClick={() => setThawing(game, "thaw")} /> : null}
          {!game.frozen && !game.linked && game.installed && id != null ? <>
            <IconAction label={c.freeze} tone="frost" disabled={busy} onClick={() => setThawing(game, "freeze")}><PhSnowflake /></IconAction>
            <IconAction label={c.deepFrozen} tone="frost" disabled={busy} onClick={() => setThawing(game, "deep")}><PhSnowflake /><b>+</b></IconAction>
          </> : null}
          {configurable(game) ? <IconAction label={c.options} disabled={busy} onClick={() => configure(game)}><GearSix /></IconAction> : null}
          {plus && kid.name && game.installed && !isSteamOwned(game) && id != null ? <IconAction label={(forKid ? c.kidHide : c.kidShow).replace("{name}", kid.name)} tone="accent" pressed={forKid} onClick={() => chooseForKid(game, c)}><Baby /></IconAction> : null}
          <IconAction label={c.history} onClick={() => setExpanded(open ? null : id)}><Scroll /></IconAction>
          <IconAction label={c.openFolder} disabled={libraryDemo() || isSteamOwned(game)} onClick={() => void digitalProcessManager.openFolder(asGame(game))}><PhFolderOpen /></IconAction>
          {/* A Steam game can also be deleted from disk, as Steam's own Uninstall does (no Steam account involved). */}
          {/* A game linked from a folder of the player's: moved into the games folder (renamed to the standard, then
              handled like any game Game Access installed) or deleted from disk with its folder. */}
          {game.link_kind === "folder" && game.installed && id != null ? <>
            <IconAction label={c.linkedMove} tone="accent" disabled={busy} onClick={() => setPending({ kind: "linked_move", game })}><ArrowSquareIn /></IconAction>
            <IconAction label={c.linkedDelete} tone="danger" disabled={busy} onClick={() => setPending({ kind: "linked_delete", game })}><Trash /></IconAction>
          </> : null}
          {game.link_kind === "steam" && game.installed && !isSteamOwned(game) ? <IconAction label={c.steamUninstall} tone="danger" disabled={busy || id == null} onClick={() => setPending({ kind: "steam_uninstall", game })}><Trash /></IconAction> : null}
          <IconAction label={game.linked ? c.unlink : c.uninstall} tone="danger" disabled={busy || id == null} onClick={() => id != null && setPending({ kind: "uninstall", ids: [id] })}>{game.linked ? <LinkBreak /> : <Trash />}</IconAction>
        </>}
      </td>
    </tr>
    {open || freezing ? <tr className="lm-detail-row"><td colSpan={columns}><div className="lm-detail">
      {open && game.issues.length && (!game.unfinished || game.stalled) ? <div><b>{c.whatNeeds}</b>
        <ul>{game.issues.map(issue => <li key={issue.code}><AlertTriangle />{issue.message}{issue.bytes ? <em>({formatBytes(issue.bytes)})</em> : null}</li>)}</ul></div> : null}
      {/* The log and, during a freeze, the game's picture beside it: same top, same height. */}
      {!game.partial ? <div><b>{c.historyTitle}</b><div className={`lm-history-row${freezing ? " has-frost" : ""}`}>
        <History game={game} c={c} job={freezing} />
        {/* Cancelled, the cubes go back where they were: the game is as it was. */}
        {freezing && id ? <FreezeBar src={landscape(id)} mode={freezing.mode} percent={freezing.outcome?.cancelled ? 0 : freezing.outcome?.ok ? 100 : freezing.progress?.percent ?? 0}
          state={freezing.outcome ? (freezing.outcome.ok || freezing.outcome.cancelled ? "done" : "failed") : "working"} size={freezeSize(freezing.progress)} /> : null}
      </div></div> : null}
    </div></td></tr> : null}
  </>);
}

/** A game of the library with no folder yet: Install, or take it out of the library. */
function AbsentRow({ row, game, c, onInstall }: { row: GridRow; game: CatalogGame; c: LibraryCopy; onInstall?: (game: CatalogGame) => void }) {
  return (
    <tr className="lm-row">
      <td className="lm-cell-check" />
      <td><span className="lm-thumb">{game.app_id ? <img src={landscape(game.app_id)} alt="" loading="lazy" /> : null}</span></td>
      <td className="lm-cell-name"><div className="lm-name" title={game.name}>{game.name}</div></td>
      <td><StatusCell status={row.status} /></td>
      <td className="lm-cell-path">—</td>
      <td className="lm-cell-size">—</td>
      <td><KindCell kind={row.kind} source="" /></td>
      <td className="lm-cell-num">—</td>
      <td className="lm-cell-num">—</td>
      <td className="lm-acts">
        {onInstall ? <IconAction label={c.install} tone="accent" onClick={() => onInstall(game)}><DownloadSimple /></IconAction> : null}
        <IconAction label={c.unlink} tone="danger" onClick={() => libraryMembership.remove(game)}><LinkBreak /></IconAction>
      </td>
    </tr>
  );
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

export default function GameLibraryManager({ onClose, catalog = [], onInstall, onPlay, focusAppId, embedded = false, query = "", scrollRef }: {
  onClose: () => void; catalog?: CatalogGame[]; onInstall?: (game: CatalogGame) => void; onPlay?: (game: CatalogGame) => void | Promise<void>;
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
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>({ key: "size", dir: -1 });
  const [selection, setSelection] = useState<Selection>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [freezing, setFreezing] = useState<{ game: LibraryGame; mode: FreezeMode } | null>(null);
  const [configuring, setConfiguring] = useState<LibraryGame | null>(null);
  useEffect(() => { void scanLibrary(); }, []);
  const importSteam = async () => {
    setBusy(true);
    try {
      const result = await syncSteamLibrary(catalog, { refresh: true });
      notify(result.found ? t("steamImported", { linked: result.linked.length, owned: result.owned.length }) : t("steamNotFound"), { tone: result.found ? "success" : "error" });
      notifyLibraryChanged();
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

  const findCatalogGame = (game: LibraryGame) => catalog.find(item => (item.app_id ?? item.id) === game.app_id) ?? members.find(item => (item.app_id ?? item.id) === game.app_id);

  const askPlan = async (ids: number[]) => {
    if (!ids.length) return;
    setBusy(true); setMessage("");
    try {
      const plans = libraryDemo() ? demoPlans(ids) : (await digitalProcessManager.libraryPlan(ids)).plans ?? [];
      setPending({ kind: "plan", plans, ids });
    } catch (failure) { setMessage(String(failure)); } finally { setBusy(false); }
  };
  const runBatch = async (action: BatchAction, ids: number[]) => {
    setBusy(true); setMessage(c.working);
    try {
      const results: Array<{ app_id: number; ok: boolean; error?: string; in_use_folder?: string }> = libraryDemo() ? ids.map(app_id => ({ app_id, ok: true })) : (await digitalProcessManager.libraryBatch(action, ids)).results ?? [];
      if (action === "adopt" && !libraryDemo()) results.forEach(row => { const found = games.find(game => game.app_id === row.app_id); if (row.ok && found) addReadyGameToLibrary(row.app_id, found.name, catalog); });
      setMessage(c.done(results.filter(row => row.ok).length, results.filter(row => !row.ok).length));
      announceBatch(action, results, games);
      // A folder held open by other programs: the notice names them, can close the Explorer windows and tries again.
      const locked = results.find(row => !row.ok && row.in_use_folder);
      if (locked?.in_use_folder) void showFolderInUse(locked.in_use_folder, () => void runBatch(action, [locked.app_id]));
      setSelection({});
    } catch (failure) { setMessage(String(failure)); notify(translate("toastActionFailed", { error: String(failure) }), { tone: "error" }); } finally { setBusy(false); setPending(null); await scanLibrary(); notifyLibraryChanged(); }
  };
  const confirmPending = async (current: Pending | null = pending) => {
    if (!current) return;
    if (current.kind === "plan") await runBatch("adopt", current.ids);
    else if (current.kind === "uninstall") await runBatch("uninstall", current.ids);
    else if (current.kind === "steam_uninstall") await runBatch("steam_uninstall", [current.game.app_id as number]);
    else if (current.kind === "linked_delete" || current.kind === "linked_move") await runBatch(current.kind, [current.game.app_id as number]);
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
    void confirmNotice({
      game: one ? noticeGame(findCatalogGame(one) ?? asGame(one)) : undefined,
      title: pending.kind === "linked_move" ? c.linkedMoveTitle(pending.game.name) : pending.kind === "linked_delete" ? c.linkedDeleteTitle(pending.game.name) : pending.kind === "steam_uninstall" ? c.steamUninstallTitle(pending.game.name) : pending.kind === "uninstall" ? (allLinked ? c.unlinkTitle(pending.ids.length) : c.uninstallTitle(pending.ids.length)) : c.discardTitle,
      text: pending.kind === "linked_move" ? c.linkedMoveBody(pending.game.folder) : pending.kind === "linked_delete" ? c.linkedDeleteBody(pending.game.folder) : pending.kind === "steam_uninstall" ? c.steamUninstallBody : pending.kind === "uninstall" ? (allLinked ? c.unlinkBody : anyLinked ? `${c.uninstallBody} ${c.unlinkNote}` : c.uninstallBody) : pending.restart ? c.restartBody : c.discardBody,
      confirmLabel: pending.kind === "linked_move" ? c.linkedMove : pending.kind === "linked_delete" ? c.linkedDelete : pending.kind === "steam_uninstall" ? c.uninstall : pending.kind === "uninstall" ? (allLinked ? c.unlink : c.uninstall) : pending.restart ? c.restart : c.discard,
      cancelLabel: c.cancel, kind: pending.kind === "linked_move" ? "primary" : "danger",
    }).then(ok => { if (!live) return; if (ok) void confirmPending(pending); else setPending(null); });
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
  const absent = filter === "all" ? members.filter(member => !games.some(game => game.app_id === (member.app_id ?? member.id)) && matches(member.name, member.app_id ?? member.id)) : [];
  const gridRows: GridRow[] = [
    ...rows.map(game => ({ key: String(game.app_id ?? game.folder), name: game.name, status: statusOf(game, c, t), path: isSteamOwned(game) ? "" : game.folder, size: sizeOf(game), kind: kindOf(game), source: sourceOf(game), plays: game.plays ?? 0, idle: idleDays(game), game })),
    ...absent.map(member => ({ key: `member-${member.app_id ?? member.id}`, name: member.name, status: { rank: 11, label: t("lmStatusNoFolder"), tone: "muted" as const }, path: "", size: 0, kind: "dd" as const, source: "", plays: 0, idle: null, member })),
  ].sort(compareRows(sort));
  const columns = 10;
  const selectable = rows.filter(game => game.app_id != null).map(game => String(game.app_id));
  const allSelected = selectable.length > 0 && selectable.every(key => selection[key]);
  const frozenStored = games.reduce((total, game) => total + (game.frozen ? game.frozen_bytes ?? game.size_bytes ?? 0 : 0), 0);
  const rowProps = { c, busy, locale, columns, expanded, setExpanded, selection, setSelection, largest, findCatalogGame, onInstall, onPlay, askPlan, setPending, setThawing: (game: LibraryGame, mode: FreezeMode) => setFreezing({ game, mode }),
    retry: (id: number) => void runBatch("adopt", [id]), configure: setConfiguring, focusId: focusAppId ?? null };

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
            <GaButton icon={<FolderInput size={16} />} disabled={busy} onClick={() => setImportOpen(true)}>{c.importGames}</GaButton>
            <GaButton icon={<Gamepad2 size={16} />} disabled={busy} onClick={() => void importSteam()}>{t("steamImportNow")}</GaButton>
          </div>
          </div>
          <div className="lm-filters">
            {filters.map(([id, label, count]) => <button key={id} type="button" className="lm-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{count}</span></button>)}
            <GaButton className="lm-icon-button lm-scan" aria-label={scanning ? c.scanning : c.scan} title={scanning ? c.scanning : c.scan} disabled={busy || scanning} onClick={() => void scanLibrary()}>{scanning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}</GaButton>
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
                {gridRows.map(row => row.game ? <ManagerRow key={row.key} row={row} game={row.game} {...rowProps} /> : row.member ? <AbsentRow key={row.key} row={row} game={row.member} c={c} onInstall={onInstall} /> : null)}
              </tbody>
            </table> : <p className="lm-empty">{games.length || members.length ? c.empty : scanning ? c.scanning : c.noGames}</p>}
            <ThirdPartyApps c={c} />
          </div>
        </div>
      </div>

      {freezing ? <FreezeDialog game={findCatalogGame(freezing.game) ?? asGame(freezing.game)} mode={freezing.mode} onClose={() => setFreezing(null)} /> : null}
      {configuring ? <DigitalGameOptions game={findCatalogGame(configuring) ?? asGame(configuring)} onClose={() => setConfiguring(null)} /> : null}
      {importOpen ? <ImportWizard catalog={catalog} c={c} onClose={imported => { setImportOpen(false); if (imported) { void scanLibrary(); notifyLibraryChanged(); } }} /> : null}
      {pending?.kind === "plan" ? <PlanDialog plans={pending.plans} c={c} busy={busy} onConfirm={() => void confirmPending()} onCancel={() => setPending(null)} /> : null}
    </TooltipProvider>
  );
}
