import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { AlertTriangle, AppWindow, ShieldAlert, ShieldCheck, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Filter as Funnel, FolderInput, Link2, Loader2, Pencil, RefreshCw, Snowflake, Trash2, Wand2, X } from "lucide-react";
// The row actions use Phosphor's filled icons (lucide only draws lines); the weight comes from the IconContext below.
import { ArrowClockwise, ArrowCounterClockwise, ArrowSquareIn, DotsThree, DownloadSimple, EyeSlash, GearSix, IdentificationCard, Flame as PhFlame, FolderOpen as PhFolderOpen, IconContext, LinkBreak, MagicWand, Play as PhPlay, Scroll, Snowflake as PhSnowflake, Trash } from "@phosphor-icons/react";
import { translate, useI18n, type TranslationKey } from "../i18n";
import RenameGameDialog from "../RenameGameDialog";
import { normalizeSearchText } from "../libraryText";
import { notify } from "../toasts";
import { digitalProcessManager, type LibraryGame, type LibraryPlan, type RunCheck } from "../catalog/DigitalProcessManager";
import { libraryDemo, libraryScanState, scanLibrary, useLibraryScan } from "../libraryScan";
import type { CatalogGame } from "../types";
import { Button } from "../components/ui/button";
import { getCoreRowModel, getFacetedMinMaxValues, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type ColumnFiltersState, type FilterFn, type Row as TableRow, type SortingState } from "@tanstack/react-table";
import ColumnFilter, { describeFilter, filterActive, listFilter, rangeFilter, type FilterKind, type RangeUnit } from "./ColumnFilter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { copy, type LibraryCopy } from "./copy";
import { demoPlans } from "./demoData";
import { formatBytes } from "./format";
import { ImportWizard } from "./ImportWizard";
import { addReadyGameToLibrary, libraryMembership, useLibraryGames } from "../libraryMembership";
import { digitalDownloadService } from "../catalog/DigitalDownloadService";
import { MoveWizard } from "./MoveWizard";
import { SizeCell } from "./SizeCell";
import { isHiddenGame, useGameCards } from "../gameCard";
import { startFreezeJob } from "../freezeJobs";
import { uiDemo } from "../devDemo/uiDemo";
import ActivityBoard from "./ActivityBoard";
import { GaBack, GaButton } from "../components/ga/Buttons";
import { confirmNotice, hideNotice, showNotice } from "../notice/notice";
import { openSection } from "../gameArea";
import { applyKidDraft, dropKidGames, kidGameCount, kidGamesAmong, loadKidFamily } from "../kidMode";
import { addShortcut, loadShortcuts, openShortcut, removeShortcut, useShortcuts, type AppShortcut } from "../appShortcuts";
import { showFolderInUse } from "./folderInUse";
import { noticeGame } from "../notice/noticeGame";
import { isSteamOwned, steamOwnerLabel } from "../steamLibrary";
import { activeDownloadService } from "../downloads/activeService";
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import ManualLinkDialog from "./ManualLinkDialog";
import type { RowAction } from "./RowExpand";
import GameDetail from "./GameDetail";
import "./manager.css";
import "./list-detail.css";

/** Which groups of the grid the player left folded (one per Steam account). */
const FOLDED_KEY = "gameaccess:lm-folded:v1";

/** The main library re-reads the games folder on focus: fixed, discarded or removed games show up there right away. */
const notifyLibraryChanged = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("focus")); };

type Selection = { [key: string]: boolean };
type Filter = "all" | "outside" | "errors" | "partial" | "frozen";
type Pending =
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

/** A click on a row picks it for the detail, unless it was on one of its controls. */
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
/** `key`: the game, for the selection (two folders of one game are one game). `uid`: the line itself, for React and the table:
 *  with two folders of one AppID (or AppID 0) a shared key made every sort add ghost rows until the app froze (Seba, 2026-11-17). */
type GridRow = { key: string; uid: string; name: string; status: Status; path: string; size: number; kind: Kind; source: string; plays: number; idle: number | null; game?: LibraryGame; member?: CatalogGame };
type SortKey = "name" | "status" | "path" | "size" | "kind" | "plays" | "idle";
type Sort = { key: SortKey; dir: 1 | -1 };
/** Numbers start from the largest, words from A. */
const firstDir = (key: SortKey): 1 | -1 => key === "size" || key === "plays" || key === "idle" ? -1 : 1;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** How each column filters (ColumnFilter.tsx): the name by a word, states, folders and sources by their values, numbers by a range. */
const FILTER_KINDS: Record<SortKey, FilterKind> = { name: "text", status: "list", path: "list", size: "range", kind: "list", plays: "range", idle: "range" };
const by = (compare: (a: GridRow, b: GridRow) => number) => (a: TableRow<GridRow>, b: TableRow<GridRow>) => compare(a.original, b.original);

/** The grid's columns for TanStack Table (Seba, 2026-11-17): what each one sorts and filters by. A row with no folder,
 *  size or day count has no value there, so it goes last both ways (`sortUndefined`) and shows as "No data". */
function gridColumns(t: Translate): ColumnDef<GridRow, unknown>[] {
  const kindName = (row: GridRow) => t(kindLabels[row.kind][0]);
  // Typed here, not as listFilter<GridRow>(): the i18n check reads "<...>" in a call as JSX.
  const wordFilter: FilterFn<GridRow> = listFilter();
  const kindFilter: FilterFn<GridRow> = listFilter((row: GridRow) => `${kindName(row)} ${row.source}`);
  const numberFilter: FilterFn<GridRow> = rangeFilter();
  return [
    { id: "name", accessorFn: row => row.name, sortingFn: by((a, b) => collator.compare(a.name, b.name)), filterFn: wordFilter },
    { id: "status", accessorFn: row => row.status.label, sortingFn: by((a, b) => a.status.rank - b.status.rank), filterFn: wordFilter },
    { id: "path", accessorFn: row => row.path || undefined, sortingFn: by((a, b) => collator.compare(a.path, b.path)), sortUndefined: "last", filterFn: wordFilter },
    { id: "size", accessorFn: row => row.size || undefined, sortingFn: "basic", sortUndefined: "last", filterFn: numberFilter },
    { id: "kind", accessorFn: kindName, sortingFn: by((a, b) => collator.compare(a.kind, b.kind) || collator.compare(a.source, b.source)), filterFn: kindFilter },
    { id: "plays", accessorFn: row => row.plays, sortingFn: "basic", filterFn: numberFilter },
    { id: "idle", accessorFn: row => row.idle ?? undefined, sortingFn: "basic", sortUndefined: "last", filterFn: numberFilter },
  ];
}
const gridModels = { getCoreRowModel: getCoreRowModel<GridRow>(), getSortedRowModel: getSortedRowModel<GridRow>(), getFilteredRowModel: getFilteredRowModel<GridRow>(),
  getFacetedRowModel: getFacetedRowModel<GridRow>(), getFacetedUniqueValues: getFacetedUniqueValues<GridRow>(), getFacetedMinMaxValues: getFacetedMinMaxValues<GridRow>() };
/** The size the row shows (SizeCell): on disk when frozen, what was downloaded for an unfinished download. */
const sizeOf = (game: LibraryGame) => game.frozen && game.frozen_bytes != null ? game.frozen_bytes : game.partial ? game.transfer_bytes ?? 0 : game.size_bytes ?? 0;
/** Whole days without playing: since the last play, or since the game came into the library when it was never played. */
export const idleDays = (game: Pick<LibraryGame, "last_played" | "added_at">, now = Date.now()) => {
  const value = game.last_played || game.added_at;
  const date = value ? new Date(value.replace(" ", "T")) : null;
  return date && !Number.isNaN(date.getTime()) ? Math.max(0, Math.floor((now - date.getTime()) / 86_400_000)) : null;
};

type RowProps = {
  row: GridRow; game: LibraryGame; c: LibraryCopy; largest: number; focusId: number | null; locale: string;
  /** The game the detail is showing, and how that changes: the last row picked (GameDetail.tsx). */
  picked: number | null; onPick: (id: number) => void;
  verdict: (game: LibraryGame) => RunCheck | null | undefined; verifying: number | null;
  selection: Selection; setSelection: (update: (current: Selection) => Selection) => void;
};

/** "Language and launch" (executable, arguments, administrator, automation), as in the game's menu: for any game on this
 *  PC (not one only owned in Steam, nor one whose files sit in the deep-freeze archive). A linked game, from Steam or from
 *  a folder, gets its launch command instead. */
const configurable = (game: LibraryGame) => game.app_id != null && !isSteamOwned(game) && !game.partial && game.frozen !== "deep";

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

/** What one game needs to offer its actions, wherever they are drawn. */
type ActionDeps = {
  c: LibraryCopy; busy: boolean; catalogGame?: CatalogGame; verifying: number | null;
  onInstall?: (game: CatalogGame) => void; onPlay?: (game: CatalogGame) => void | Promise<void>;
  askPlan: (ids: number[]) => Promise<void>; setPending: (pending: Pending) => void;
  retry: (id: number) => void; verify: (game: LibraryGame) => void; rename: () => void;
};

/*
 * What one game offers, by its state (Seba, 2026-11-19). **They are drawn in the detail, not in the grid**: what is
 * about a single game -- play it, resume it, fix it, check that it runs, open its folder, rename it, uninstall it --
 * belongs to the detail at the left, where that game is already open. The grid keeps what is about **groups** of
 * games: import, fix them all, check the installed ones, and whatever is done to the ticked rows.
 * Compressing, expanding and moving a game between disks are not here at all: they belong to Manager > Space.
 */
function gameActions(game: LibraryGame, d: ActionDeps): RowAction[] {
  const id = game.app_id;
  const { c, busy, catalogGame } = d;
  const unfinished = game.partial || isUnfinished(game);
  const failed = (failure: unknown) => notify(translate("toastActionFailed", { error: String(failure instanceof Error ? failure.message : failure) }), { tone: "error" });
  const openDownloadFolder = act(c.openDownloadFolder, <PhFolderOpen />, () => void digitalProcessManager.openFolder(asGame(game), "download"), { disabled: libraryDemo() });
  if (unfinished && !game.transfer_active) return [
    // A stopped download goes on from the step it reached, through the Download Manager (no plugin needed);
    // without one, the transfer starts again from the catalog.
    game.resume_step
      ? act(game.resume_step === "extract" ? c.resumeExtract : c.resumeDownload, <PhPlay />, () => void digitalDownloadService.retry(catalogGame ?? asGame(game)).then(() => scanLibrary(), failed), { tone: "accent", disabled: busy })
      : act(!catalogGame ? c.cannotResume : game.transfer_kind === "pieces" ? c.resumePieces : c.resumeOther, <PhPlay />, () => { if (catalogGame) d.onInstall?.(catalogGame); }, { tone: "accent", disabled: !catalogGame || busy }),
    ...(game.partial ? [act(c.restart, <ArrowCounterClockwise />, () => d.setPending({ kind: "discard", game, restart: true }), { disabled: busy })] : []),
    openDownloadFolder,
    act(c.discardAll, <Trash />, () => d.setPending({ kind: "discard", game, restart: false }), { tone: "danger", disabled: busy }),
  ];
  if (game.partial || game.transfer_active) return [openDownloadFolder];
  return [
    ...(game.installed && game.frozen !== "deep" && catalogGame && d.onPlay ? [act(c.play, <PhPlay />, () => void d.onPlay?.(catalogGame), { tone: "accent", disabled: busy })] : []),
    ...(isSteamOwned(game) ? [act(translate("steamInstallMenu"), <DownloadSimple />, () => d.onInstall?.(catalogGame ?? asGame(game)), { tone: "accent", disabled: busy })] : []),
    // A folder that ended in ERROR (an installer that failed, say) is processed again straight away: unpacked,
    // installed and checked, as Fix does, after any change made in "Language and launch".
    ...(retryable(game) && id != null ? [act(c.retryProcess, <ArrowClockwise />, () => d.retry(id), { tone: "accent", disabled: busy })]
      : needsFix(game) && id != null ? [act(c.fix, <MagicWand />, () => void d.askPlan([id]), { tone: "accent", disabled: busy })] : []),
    ...(canVerify(game) ? [act(c.verify, d.verifying === id ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />, () => d.verify(game), { disabled: busy || d.verifying != null })] : []),
    act(c.openFolder, <PhFolderOpen />, () => void digitalProcessManager.openFolder(asGame(game)), { disabled: libraryDemo() || isSteamOwned(game) }),
    ...(id != null ? [act(translate("renameMenu"), <Pencil size={16} />, () => d.rename(), { disabled: busy })] : []),
    // A game linked from a folder of the player's: moved into the games folder, or deleted from disk with its folder.
    ...(game.link_kind === "folder" && game.installed && id != null ? [
      act(c.linkedMove, <ArrowSquareIn />, () => d.setPending({ kind: "linked_move", game }), { tone: "accent", disabled: busy }),
      act(c.linkedDelete, <Trash />, () => d.setPending({ kind: "linked_delete", game }), { tone: "danger", disabled: busy }),
    ] : []),
    // A Steam game can also be deleted from disk, as Steam's own Uninstall does (no Steam account involved).
    ...(game.link_kind === "steam" && game.installed && !isSteamOwned(game) ? [act(c.steamUninstall, <Trash />, () => d.setPending({ kind: "steam_uninstall", game }), { tone: "danger", disabled: busy || id == null })] : []),
    // A Steam game is in its account's library while the account owns it: it is never taken out on its own (the
    // account is, in Manager > Accounts), only uninstalled from the disk (above).
    ...(game.link_kind === "steam" ? [] : [act(game.linked ? c.unlink : c.uninstall, game.linked ? <LinkBreak /> : <Trash />, () => { if (id != null) d.setPending({ kind: "uninstall", ids: [id] }); }, { tone: "danger", disabled: busy || id == null })]),
  ];
}

/** One line of the grid: only what the game is. Its actions are in the detail; a click on it opens that game there. */
function ManagerRow({ row, game, c, largest, focusId, picked, onPick, verdict, verifying, selection, setSelection }: RowProps) {
  const id = game.app_id;
  const key = row.key;
  const cards = useGameCards();
  const ref = useRef<HTMLTableRowElement>(null);
  const focused = focusId != null && focusId === id;
  // The row the detail is showing (the last one picked), which is not the same as the ticked ones.
  const chosen = picked != null && picked === id;
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focused]);
  return (
    <tr ref={ref} className={`lm-row is-openable${focused ? " is-focus" : ""}${selection[key] ? " is-selected" : ""}${chosen ? " is-picked" : ""}`} data-app-id={id ?? undefined}
      aria-current={chosen ? "true" : undefined}
      onClick={event => { if (!onControl(event) && id != null) onPick(id); }}>
      <td className="lm-cell-check">{id != null ? <input type="checkbox" className="lm-check" tabIndex={-1} aria-label={game.name} checked={Boolean(selection[key])} onChange={event => { const value = event.target.checked; setSelection(current => ({ ...current, [key]: value })); if (value && id != null) onPick(id); }} /> : null}</td>
      <td className="lm-cell-name">
        <div className="lm-name" title={game.name}>{game.name}</div>
        {id != null && isHiddenGame({ app_id: id, id }, cards) ? <span className="lm-status" title={c.hiddenInPlayTip}><EyeSlash />{c.hiddenInPlay}</span> : null}
      </td>
      <td>{isUnfinished(game) || game.transfer_active
        ? <button type="button" className="lm-status-link" title={translate("lmGoToDownloads")} onClick={event => { event.stopPropagation(); openSection("downloads"); }}><StatusCell status={row.status} /></button>
        : <StatusCell status={row.status} />}<RunBadge check={verdict(game)} running={verifying === id} c={c} /></td>
      <td className="lm-cell-path" title={row.path}>{row.path || "—"}</td>
      <td className="lm-cell-size"><SizeCell game={game} largest={largest} c={c} /></td>
      <td><KindCell kind={row.kind} source={row.source} /></td>
      <td className="lm-cell-num">{row.plays || "—"}</td>
      <td className="lm-cell-num">{row.idle ?? "—"}</td>
    </tr>
  );
}

/** A game of the library with no folder yet: its actions (install it, take it out) are in the detail too. */
function AbsentRow({ row, game, c, picked, onPick }: { row: GridRow; game: CatalogGame; c: LibraryCopy; picked: number | null; onPick: (id: number) => void }) {
  const id = game.app_id ?? game.id;
  const chosen = picked != null && picked === id;
  return (
    <tr className={`lm-row is-openable${chosen ? " is-picked" : ""}`} aria-current={chosen ? "true" : undefined}
      onClick={event => { if (!onControl(event)) onPick(id); }}>
      <td className="lm-cell-check" />
      <td className="lm-cell-name"><div className="lm-name" title={game.name}>{game.name}</div></td>
      <td><StatusCell status={row.status} /></td>
      <td className="lm-cell-path">—</td>
      <td className="lm-cell-size">—</td>
      <td><KindCell kind={row.kind} source="" /></td>
      <td className="lm-cell-num">—</td>
      <td className="lm-cell-num">—</td>
    </tr>
  );
}

/** The games whose download has not ended (Downloads follows them; they are not in the library yet), kept up to date. */
function useDownloadingIds(): Set<number> {
  const read = () => new Set(activeDownloadService().getDownloads()
    .filter(entry => !isDownloadHistory(entry.snapshot.phase))
    .map(entry => entry.game.app_id ?? entry.snapshot.gameId));
  const [ids, setIds] = useState(read);
  useEffect(() => activeDownloadService().onGlobalUpdate(() => setIds(read())), []); // eslint-disable-line react-hooks/exhaustive-deps
  return ids;
}

/** A column header that sorts: one click sorts, the next one reverses; the arrow says which way. */
function SortHeader({ id, label, title, sort, setSort, t, filtered, onFilter }: { id: SortKey; label: string; title?: string; sort: Sort; setSort: (sort: Sort) => void; t: Translate;
  /** The column's filter (ColumnFilter): a right click on the header or its funnel opens it. */ filtered: boolean; onFilter: (key: SortKey, anchor: DOMRect) => void }) {
  const active = sort.key === id;
  const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} onContextMenu={event => { event.preventDefault(); onFilter(id, event.currentTarget.getBoundingClientRect()); }}>
      <button type="button" className={`lm-sort${active ? " is-active" : ""}`} title={title ? `${title}. ${t("lmSortBy", { column: label })}` : t("lmSortBy", { column: label })}
        onClick={() => setSort(active ? { key: id, dir: sort.dir === 1 ? -1 : 1 } : { key: id, dir: firstDir(id) })}>
        {label}<Icon aria-hidden="true" />
      </button>
      <button type="button" className={`lm-colfilter-open${filtered ? " is-on" : ""}`} aria-label={t("lmFilterOpen", { column: label })} title={t("lmFilterOpen", { column: label })}
        aria-pressed={filtered} onClick={event => onFilter(id, (event.currentTarget.closest("th") ?? event.currentTarget).getBoundingClientRect())}><Funnel aria-hidden="true" /></button>
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
  const { games, scanning, error } = useLibraryScan();
  useEffect(() => { void loadKidFamily(); }, []);
  const members = useLibraryGames();
  const downloading = useDownloadingIds();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>({ key: "size", dir: -1 });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [filterOpen, setFilterOpen] = useState<{ key: SortKey; anchor: DOMRect } | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  // The game the detail shows: the last row picked (a click on it, a tick, or "Manage" on the back of a library card).
  const [picked, setPicked] = useState<number | null>(null);
  // "Rename" is one game's action, so it is asked from the detail.
  const [renaming, setRenaming] = useState<LibraryGame | null>(null);
  // Groups folded by the player (one per Steam account), kept on this PC so the view opens as they left it.
  const [folded, setFolded] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) || "[]") as string[]); } catch { return new Set(); }
  });
  const fold = (key: string) => setFolded(current => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify([...next])); } catch { /* kept for this session */ }
    return next;
  });
  const [pending, setPending] = useState<Pending | null>(null);
  const [moving, setMoving] = useState<{ plans: LibraryPlan[]; ids: number[] } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // "Does it run here?": one game, or every installed and linked one in turn (stoppable between games).
  const [verdicts, setVerdicts] = useState<Record<number, RunCheck>>({});
  const [verifying, setVerifying] = useState<{ id: number | null; done: number; total: number; name: string } | null>(null);
  const stopVerify = useRef(false);
  const [message, setMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
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
  // The Steam accounts' libraries come in whole from Manager › Accounts (AccountLibraries.tsx), never game by game.
  // A game opened from Activity shows its row open: the download's or the process's detail (Seba, 2026-11-03).
  useEffect(() => { if (focusAppId != null) { setFilter("all"); setPicked(focusAppId); } }, [focusAppId]);
  // Every word of the search in the name, without accents or case, as in the catalog; the game "Manage" opened stays.
  const terms = useMemo(() => normalizeSearchText(query.trim()).split(/\s+/).filter(Boolean), [query]);
  const matches = (name: string, appId?: number | null) => !terms.length || (focusAppId != null && appId === focusAppId) || terms.every(term => normalizeSearchText(name).includes(term));

  /*
   * A download on its way is the Download Manager's, not this grid's (Seba, 2026-11-19): a game is **downloaded and
   * installed** before it becomes part of the library, and only then does it have a row here. So a folder that is
   * still downloading, unpacking or being prepared is left out unless the player already put that game in their
   * library; then it does show --one game is never in two places under two different stories-- and a click on its
   * state takes them to the Download Manager, which is where that job is followed.
   */
  const inLibrary = useMemo(() => new Set(members.map(member => member.app_id ?? member.id)), [members]);
  const arriving = (game: LibraryGame) => (isUnfinished(game) || Boolean(game.partial) || ["downloading", "installing", "preparing"].includes(game.state))
    && !(game.app_id != null && inLibrary.has(game.app_id));
  const counts = useMemo(() => {
    const listed = games.filter(game => !arriving(game) && !(game.app_id != null && downloading.has(game.app_id)));
    return { all: listed.length, outside: listed.filter(needsFix).length, errors: listed.filter(hasError).length,
      partial: listed.filter(isUnfinished).length, frozen: listed.filter(game => game.frozen).length };
  }, [games, downloading, inLibrary]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => games.filter(game => {
    if (!matches(game.name, game.app_id)) return false;
    // A game still downloading belongs to the Download Manager until it is installed.
    if (game.app_id != null && downloading.has(game.app_id)) return false;
    if (arriving(game)) return false;
    return filter === "all" || (filter === "outside" && needsFix(game)) || (filter === "errors" && hasError(game)) || (filter === "partial" && isUnfinished(game)) || (filter === "frozen" && Boolean(game.frozen));
  }), [games, filter, terms, focusAppId, downloading, inLibrary]); // eslint-disable-line react-hooks/exhaustive-deps
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
        let result = await digitalProcessManager.verifyRun(asGame(game));
        // One game checked on purpose and still open (a test that stopped on a dialog nobody accepted): close it and try again.
        if (result.skipped === "running" && queue.length === 1
          && await confirmNotice({ title: c.verifyOpenTitle(game.name), text: c.verifyOpenText, confirmLabel: c.verifyOpenYes, cancelLabel: c.cancel })) {
          result = await digitalProcessManager.verifyRun(asGame(game), true);
        }
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
      const plans = libraryDemo() || uiDemo() ? demoPlans(ids) : (await digitalProcessManager.libraryPlan(ids)).plans ?? [];
      setMoving({ plans, ids });
    } catch (failure) { setMessage(String(failure)); } finally { setBusy(false); }
  };
  const runBatch = async (action: BatchAction, ids: number[]): Promise<number[]> => {
    setBusy(true); setMessage(c.working);
    let worked: number[] = [];
    try {
      const results: Array<{ app_id: number; ok: boolean; error?: string; in_use_folder?: string }> = libraryDemo() || uiDemo() ? ids.map(app_id => ({ app_id, ok: true })) : (await digitalProcessManager.libraryBatch(action, ids)).results ?? [];
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
    if (current.kind === "uninstall") releaseKidGames(await runBatch("uninstall", current.ids));
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
    if (!pending) return;
    // A Steam game is uninstalled for real (deleted from disk, as Steam does): it is not "only removed" like a link.
    const linkedIds = new Set(games.filter(game => game.linked && game.link_kind !== "steam").map(game => game.app_id));
    const steamIds = new Set(games.filter(game => game.link_kind === "steam").map(game => game.app_id));
    const anySteam = pending.kind === "uninstall" && pending.ids.some(id => steamIds.has(id));
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
      text: (pending.kind === "linked_move" ? c.linkedMoveBody(pending.game.folder) : pending.kind === "linked_delete" ? c.linkedDeleteBody(pending.game.folder) : pending.kind === "steam_uninstall" ? c.steamUninstallBody : pending.kind === "uninstall" ? (allLinked ? c.unlinkBody : [c.uninstallBody, anyLinked ? c.unlinkNote : "", anySteam ? c.steamUninstallNote : ""].filter(Boolean).join(" ")) : pending.restart ? c.restartBody : c.discardBody) + kidNote,
      confirmLabel: pending.kind === "linked_move" ? c.linkedMove : pending.kind === "linked_delete" ? c.linkedDelete : pending.kind === "steam_uninstall" ? c.uninstall : pending.kind === "uninstall" ? (allLinked ? c.unlink : c.uninstall) : pending.restart ? c.restart : c.discard,
      cancelLabel: c.cancel, kind: pending.kind === "linked_move" ? "primary" : "danger",
    }).then(ok => { if (!live) return; if (ok) void confirmPending(pending); else setPending(null); });
    void confirm();
    return () => { live = false; };
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const [escapeGuard, setEscapeGuard] = useState(false);
  useEffect(() => setEscapeGuard(Boolean(pending) || Boolean(moving) || importOpen || linkOpen), [pending, moving, importOpen, linkOpen]);
  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !escapeGuard) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escapeGuard, onClose, embedded]);

  const filters: [Filter, string, number][] = ([["all", c.all, counts.all], ["outside", c.outside, counts.outside], ["errors", c.errors, counts.errors], ["partial", c.partial, counts.partial], ["frozen", c.frozenFilter, counts.frozen]] as [Filter, string, number][]).filter(([id, , count]) => id === "all" || id === filter || count > 0);
  const absent = filter === "all" ? members.filter(member => !games.some(game => game.app_id === (member.app_id ?? member.id)) && !downloading.has(member.app_id ?? member.id) && matches(member.name, member.app_id ?? member.id)) : [];
  const absentKey = absent.map(member => member.app_id ?? member.id).join(",");
  const gridRowsAll: GridRow[] = useMemo(() => [
    ...rows.map(game => ({ key: String(game.app_id ?? game.folder), uid: `${game.app_id ?? ""}|${game.folder}`, name: game.name, status: statusOf(game, c, t), path: isSteamOwned(game) ? "" : game.folder, size: sizeOf(game), kind: kindOf(game), source: sourceOf(game), plays: game.plays ?? 0, idle: idleDays(game), game })),
    ...absent.map(member => ({ key: `member-${member.app_id ?? member.id}`, uid: `member-${member.app_id ?? member.id}`, name: member.name, status: { rank: 11, label: t("lmStatusNoFolder"), tone: "muted" as const }, path: "", size: 0, kind: "dd" as const, source: "", plays: 0, idle: null, member })),
  ], [rows, absentKey, c, t]); // eslint-disable-line react-hooks/exhaustive-deps
  // The grid is a TanStack Table (Seba, 2026-11-17): it sorts, filters each column and counts each column's values;
  // the rows are still drawn here, with the app's look. Within one sort, by name.
  const columnDefs = useMemo(() => gridColumns(t), [t]);
  /*
   * The state handed to the table is **kept** (Seba, 2026-11-19): a `state` object —or a `sorting` array— built anew
   * on every render makes TanStack ask for another render on every render, so the grid redraws itself without pause.
   * With 253 games each pass costs about 200 ms, and the app never catches up: it looks frozen as soon as the view
   * opens. Keeping these two makes the loop stop (0 renders when nothing changes, measured).
   */
  const sorting = useMemo<SortingState>(() => sort.key === "name" ? [{ id: "name", desc: sort.dir === -1 }]
    : [{ id: sort.key, desc: sort.dir === -1 }, { id: "name", desc: false }], [sort.key, sort.dir]);
  const tableState = useMemo(() => ({ sorting, columnFilters }), [sorting, columnFilters]);
  const table = useReactTable({ data: gridRowsAll, columns: columnDefs, state: tableState, onColumnFiltersChange: setColumnFilters,
    getRowId: row => row.uid, enableMultiSort: true, ...gridModels });
  const gridRows = table.getRowModel().rows.map(row => row.original);
  const columnLabels: Record<SortKey, string> = { name: t("lmColName"), status: t("lmColStatus"), path: t("lmColPath"), size: t("lmColSize"), kind: t("lmColKind"), plays: t("lmColPlays"), idle: t("lmColIdle") };
  const sizeUnit: RangeUnit = { scale: 1024 ** 3, format: value => formatBytes(value), from: t("lmFilterFromGb"), to: t("lmFilterToGb") };
  const filtered = (key: SortKey) => filterActive(table.getColumn(key)?.getFilterValue());
  const openFilter = (key: SortKey, anchor: DOMRect) => setFilterOpen({ key, anchor });
  const headerProps = { sort, setSort, t, onFilter: openFilter };
  const columns = 8;
  const pickedRow = picked == null ? undefined : gridRows.find(row => row.game?.app_id === picked);
  // One block per library: Game Access's own first, then each account's (apps/launcher/account_registry.py).
  const groups = new Map<string, { title: string; hint: string; rows: GridRow[] }>([["gameaccess", { title: c.groupGameAccess, hint: c.groupHint, rows: [] }]]);
  for (const row of gridRows) {
    const library = row.game?.library;
    const key = library ? `${library.store}:${library.account_id}` : "gameaccess";
    if (!groups.has(key)) groups.set(key, { title: c.groupAccount("Steam", library?.account || library?.account_id || ""), hint: c.groupAccountHint, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  const blocks = [...groups.entries()].filter(([, group]) => group.rows.length);
  const selectable = rows.filter(game => game.app_id != null).map(game => String(game.app_id));
  const allSelected = selectable.length > 0 && selectable.every(key => selection[key]);
  const rowProps = { c, locale, picked, onPick: setPicked, selection, setSelection, largest, verdict, verifying: verifying?.id ?? null, focusId: focusAppId ?? null };
  // The picked game's own actions, drawn in the detail: the grid only keeps what is done to groups of games.
  const pickedActions = pickedRow?.game ? gameActions(pickedRow.game, { c, busy, catalogGame: findCatalogGame(pickedRow.game), verifying: verifying?.id ?? null,
    onInstall, onPlay, askPlan, setPending, retry: (id: number) => void runBatch("adopt", [id]),
    verify: (game: LibraryGame) => void verifyGames([game]), rename: () => setRenaming(pickedRow.game ?? null) })
    : pickedRow?.member ? [
      ...(onInstall ? [act(c.install, <DownloadSimple />, () => onInstall(pickedRow.member as CatalogGame), { tone: "accent" as const })] : []),
      act(c.unlink, <LinkBreak />, () => libraryMembership.remove(pickedRow.member as CatalogGame), { tone: "danger" as const }),
    ] : [];

  return (
    <TooltipProvider delayDuration={150}>
      <div className={embedded ? "lm-root is-embedded" : "lm-root fixed inset-x-0 bottom-0 top-[var(--window-chrome-height,34px)] z-[600] overflow-y-auto bg-background"} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-label={c.title}>
        {embedded ? null : <header className="ga-screen-header !max-w-none"><h2 className="ga-screen-title mr-auto">{c.title}</h2><GaBack label={c.back} onClick={onClose} data-dialog-initial /></header>}
        <div className="lm-content">
          {/* One toolbar: the actions in a row from the left edge (the main one first), what is running on the right. */}
          <div className="lm-top">
          <div className="lm-actions">
            <GaButton variant="primary" icon={<Wand2 size={16} />} disabled={busy || !fixable.length} onClick={() => void askPlan(fixable)}>{c.fixAll} ({fixable.length})</GaButton>
            <GaButton icon={<FolderInput size={16} />} disabled={busy} onClick={() => { rememberKnown(); setImportOpen(true); }}>{c.importGames}</GaButton>
            <GaButton icon={<Link2 size={16} />} disabled={busy} onClick={() => setLinkOpen(true)}>{t("manualDownloadAdd")}</GaButton>
            {verifying
              ? <GaButton icon={<X size={16} />} onClick={() => { stopVerify.current = true; }} title={c.verifyNote}>{c.verifyRunning(verifying.done, verifying.total, verifying.name)} · {c.verifyCancel}</GaButton>
              : <GaButton icon={<ShieldCheck size={16} />} disabled={busy} title={c.verifyNote} onClick={() => void verifyGames(games)}>{c.verifyAll} ({games.filter(canVerify).length})</GaButton>}
          </div>
          <ActivityBoard scanning={scanning} working={busy} />
          </div>
          <div className="lm-filters">
            {filters.map(([id, label, count]) => <button key={id} type="button" className="lm-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{count}</span></button>)}
            {columnFilters.map(({ id, value }) => { const key = id as SortKey;
              return <button key={`col-${key}`} type="button" className="lm-chip lm-colfilter-chip" aria-pressed={true} title={t("lmFilterClearColumn", { column: columnLabels[key] })}
                onClick={() => table.getColumn(key)?.setFilterValue(undefined)}>{t("lmFilterChip", { column: columnLabels[key], value: describeFilter(value, t, key === "size" ? sizeUnit : undefined, t("lmFilterEmpty")) })}<X size={14} aria-hidden="true" /></button>; })}
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
          {/* The detail of the game picked at the left, the list of games at the right (§4.49). */}
          <div className="lm-split">
          <GameDetail game={pickedRow?.game} member={pickedRow?.member} catalogGame={pickedRow?.game ? findCatalogGame(pickedRow.game) : undefined} c={c} picked={selectedIds.length} actions={pickedActions} />
          <div ref={scrollRef} className="lm-grid-wrap">
            {gridRowsAll.length ? <table className="lm-grid">
              <thead><tr>
                <th className="lm-cell-check"><input type="checkbox" className="lm-check" tabIndex={-1} aria-label={t("lmSelectAll")} title={t("lmSelectAll")} checked={allSelected} disabled={!selectable.length} onChange={event => { const value = event.target.checked; setSelection(() => value ? Object.fromEntries(selectable.map(key => [key, true])) : {}); }} /></th>
                <SortHeader id="name" label={t("lmColName")} filtered={filtered("name")} {...headerProps} />
                <SortHeader id="status" label={t("lmColStatus")} filtered={filtered("status")} {...headerProps} />
                <SortHeader id="path" label={t("lmColPath")} filtered={filtered("path")} {...headerProps} />
                <SortHeader id="size" label={t("lmColSize")} filtered={filtered("size")} {...headerProps} />
                <SortHeader id="kind" label={t("lmColKind")} filtered={filtered("kind")} {...headerProps} />
                <SortHeader id="plays" label={t("lmColPlays")} filtered={filtered("plays")} {...headerProps} />
                <SortHeader id="idle" label={t("lmColIdle")} title={t("lmColIdleTitle")} filtered={filtered("idle")} {...headerProps} />
              </tr></thead>
              {blocks.map(([key, group]) => { const shut = blocks.length > 1 && folded.has(key);
                return <tbody key={key} className={`lm-group${shut ? " is-folded" : ""}`} data-library={key}>
                {blocks.length > 1 ? <tr className="lm-group-row"><th colSpan={columns} scope="rowgroup">
                  <button type="button" className="lm-group-toggle" aria-expanded={!shut} aria-label={t("lmGroupFold")} title={t("lmGroupFold")} onClick={() => fold(key)}><ChevronDown size={16} aria-hidden="true" /></button>
                  <span className="lm-group-title">{group.title}</span><span className="lm-group-count">{group.rows.length}</span><span className="lm-group-hint">{group.hint}</span></th></tr> : null}
                {shut ? null : group.rows.map(row => row.game ? <ManagerRow key={row.uid} row={row} game={row.game} {...rowProps} /> : row.member ? <AbsentRow key={row.uid} row={row} game={row.member} c={c} picked={picked} onPick={setPicked} /> : null)}
              </tbody>; })}
            </table> : <p className="lm-empty">{games.length || members.length ? c.empty : scanning ? c.scanning : c.noGames}</p>}
            <ThirdPartyApps c={c} />
          </div>
          </div>
        </div>
      </div>

      {filterOpen && table.getColumn(filterOpen.key) ? <ColumnFilter column={table.getColumn(filterOpen.key)!} kind={FILTER_KINDS[filterOpen.key]} label={columnLabels[filterOpen.key]}
        anchor={filterOpen.anchor} unit={filterOpen.key === "size" ? sizeUnit : undefined} onClose={() => setFilterOpen(null)} /> : null}
      {linkOpen ? <ManualLinkDialog onClose={() => setLinkOpen(false)} /> : null}
      {renaming ? <RenameGameDialog game={asGame(renaming)} current={renaming.label ?? ""} onClose={() => setRenaming(null)} /> : null}
      {importOpen ? <ImportWizard catalog={catalog} c={c} onClose={imported => { setImportOpen(false); if (imported) { notifyLibraryChanged(); void suggestVerify(); } }} /> : null}
      {moving ? <MoveWizard plans={moving.plans} c={c} run={() => runBatch("adopt", moving.ids)} onClose={() => setMoving(null)} /> : null}
    </TooltipProvider>
  );
}
