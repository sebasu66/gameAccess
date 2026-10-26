import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Download, Gamepad2, Flame, FolderInput, FolderOpen, Link2Off, Loader2, Play, RotateCcw, ScanSearch, ScrollText, Snowflake, Trash2, Wand2, X } from "lucide-react";
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
import { useFreezeJob } from "../freezeJobs";
import { GaBack, GaButton } from "../components/ga/Buttons";
import { confirmNotice } from "../notice/notice";
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
  | { kind: "discard"; game: LibraryGame; restart: boolean };

const asGame = (game: LibraryGame): CatalogGame => ({ id: game.app_id, app_id: game.app_id, name: game.name } as CatalogGame);
const hasError = (game: LibraryGame) => !game.unfinished && game.issues.some(issue => issue.code === "error");
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
  if (game.partial || game.unfinished || isUnfinished(game)) {
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

/** Who it belongs to or who provided it: the Steam account that owns it, or the download's provider. */
function sourceOf(game: LibraryGame): string {
  if (game.link_kind === "steam") return steamOwnerLabel(game.steam_owner);
  return game.linked ? "" : game.source_provider ?? "";
}

function subline(game: LibraryGame, c: LibraryCopy): string {
  if (game.resume_step && !game.transfer_active) return game.resume_step === "extract" ? c.stoppedAtExtract : c.stoppedAtDownload;
  if (game.partial) return `${c.partialDl}: ${formatBytes(game.transfer_bytes)}`;
  if (game.unfinished && !game.standard) return c.pendingHint;
  if (!game.standard) return game.issues[0]?.message ?? game.warning;
  return "";
}

function IconAction({ label, onClick, disabled, tone, children }: { label: string; onClick: () => void; disabled?: boolean; tone?: "danger" | "frost" | "accent"; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={`lm-act${tone ? ` ${tone}` : ""}`} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Thaw a frozen game: opens the same dialog as the game menu (it narrates the work, a notice if it is closed). */
function ThawAction({ game, c, disabled, onClick }: { game: LibraryGame; c: LibraryCopy; disabled: boolean; onClick: () => void }) {
  const running = useFreezeJob(game.app_id);
  return <IconAction label={c.thaw} tone="frost" disabled={disabled || Boolean(running)} onClick={onClick}>{running ? <Loader2 className="animate-spin" /> : <Flame />}</IconAction>;
}

function History({ game, c }: { game: LibraryGame; c: LibraryCopy }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (libraryDemo()) { setText("2026-10-12 21:04:11 | importado | carpeta adaptada al estándar actual\n2026-10-12 21:04:12 | analisis | estado=ready; ejecutable=Game/game.exe"); return; }
    void digitalProcessManager.gameLog(asGame(game)).then(result => { if (live) setText(result.log ?? ""); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [game.app_id]);
  return <pre className="lm-history">{text === null ? c.working : text || c.noHistory}</pre>;
}

/** One notice per Library Manager action, saying how many games it changed and how many failed. */
function announceBatch(action: "adopt" | "uninstall" | "discard_transfer", results: Array<{ app_id: number; ok: boolean; error?: string }>, games: LibraryGame[]): void {
  if (!results.length) return;
  const ok = results.filter(row => row.ok).length;
  const failed = results.length - ok;
  if (action === "discard_transfer") {
    const row = results[0];
    const name = games.find(game => game.app_id === row.app_id)?.name ?? `#${row.app_id}`;
    if (row.ok) notify(translate("toastTransferDiscarded", { name }), { tone: "success" });
    else notify(translate("toastActionFailed", { error: row.error || name }), { tone: "error" });
    return;
  }
  const summary = translate(action === "adopt" ? "toastLibraryFixed" : "toastLibraryUninstalled", { ok });
  notify(failed ? translate("toastBatchFailures", { summary, failed }) : summary, { tone: !failed ? "success" : ok ? "warning" : "error" });
}

/** One line of the grid, a game with a folder or a member of the library without one, with the values it sorts by. */
type GridRow = { key: string; name: string; status: Status; path: string; size: number; kind: Kind; source: string; plays: number; last: string; game?: LibraryGame; member?: CatalogGame };
type SortKey = "name" | "status" | "path" | "size" | "kind" | "source" | "plays" | "last";
type Sort = { key: SortKey; dir: 1 | -1 };
/** Numbers and dates start from the largest, words from A. */
const firstDir = (key: SortKey): 1 | -1 => key === "size" || key === "plays" || key === "last" ? -1 : 1;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const compareRows = ({ key, dir }: Sort) => (a: GridRow, b: GridRow) => {
  // A row with no folder, source or play goes last in both directions.
  if ((key === "path" || key === "source" || key === "last") && !a[key] !== !b[key]) return a[key] ? -1 : 1;
  const order = key === "status" ? a.status.rank - b.status.rank
    : key === "size" || key === "plays" ? a[key] - b[key]
    : collator.compare(a[key], b[key]);
  return order * dir || collator.compare(a.name, b.name);
};
/** The size the row shows (SizeCell): on disk when frozen, what was downloaded for an unfinished download. */
const sizeOf = (game: LibraryGame) => game.frozen && game.frozen_bytes != null ? game.frozen_bytes : game.partial ? game.transfer_bytes ?? 0 : game.size_bytes ?? 0;
const shortDate = (value: string, locale: string) => {
  const date = value ? new Date(value.replace(" ", "T")) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(locale) : "—";
};

type RowProps = {
  row: GridRow; game: LibraryGame; c: LibraryCopy; busy: boolean; largest: number; focusId: number | null; locale: string; columns: number;
  expanded: number | null; setExpanded: (id: number | null) => void;
  selection: Selection; setSelection: (update: (current: Selection) => Selection) => void;
  findCatalogGame: (game: LibraryGame) => CatalogGame | undefined;
  onInstall?: (game: CatalogGame) => void; onPlay?: (game: CatalogGame) => void | Promise<void>;
  askPlan: (ids: number[]) => Promise<void>; setPending: (pending: Pending) => void; setThawing: (game: LibraryGame, mode: FreezeMode) => void;
};

function KindCell({ kind }: { kind: Kind }) {
  const { t } = useI18n();
  const [label, title] = kindLabels[kind];
  return <span className={`lm-kind ${kind}`} title={title ? t(title) : undefined}>{t(label)}</span>;
}

function StatusCell({ status }: { status: Status }) {
  return <span className={`lm-status ${status.tone}`}>{status.icon}{status.label}</span>;
}

/** A row of the grid: picture, name (and a line only when it adds something), state, folder, size, source, plays,
 *  last play and the row's actions. */
function ManagerRow({ row, game, c, busy, largest, focusId, locale, columns, expanded, setExpanded, selection, setSelection, findCatalogGame, onInstall, onPlay, askPlan, setPending, setThawing }: RowProps) {
  const id = game.app_id;
  const key = row.key;
  const open = expanded === id;
  const catalogGame = findCatalogGame(game);
  const line = subline(game, c);
  const unfinished = game.partial || isUnfinished(game);
  const ref = useRef<HTMLTableRowElement>(null);
  const focused = focusId != null && focusId === id;
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focused]);
  return (<>
    <tr ref={ref} className={`lm-row${focused ? " is-focus" : ""}${selection[key] ? " is-selected" : ""}`} data-app-id={id ?? undefined}>
      <td className="lm-cell-check">{id != null ? <input type="checkbox" className="lm-check" tabIndex={-1} aria-label={game.name} checked={Boolean(selection[key])} onChange={event => { const value = event.target.checked; setSelection(current => ({ ...current, [key]: value })); }} /> : null}</td>
      <td><span className={`lm-thumb${game.frozen ? " is-frozen" : ""}`}>{id ? <img src={landscape(id)} alt="" loading="lazy" /> : null}</span></td>
      <td className="lm-cell-name">
        <div className="lm-name" title={game.name}>{game.name}</div>
        {line ? <div className={`lm-line${!game.standard && !game.unfinished ? " warn" : ""}`}>{line}</div> : null}
      </td>
      <td><StatusCell status={row.status} /></td>
      <td className="lm-cell-path" title={row.path}>{row.path || "—"}</td>
      <td className="lm-cell-size"><SizeCell game={game} largest={largest} c={c} /></td>
      <td><KindCell kind={row.kind} /></td>
      <td className="lm-cell-source" title={row.source || undefined}>{row.source || "—"}</td>
      <td className="lm-cell-num">{row.plays || "—"}</td>
      <td className="lm-cell-num">{shortDate(row.last, locale)}</td>
      <td className="lm-acts">
        {unfinished && !game.transfer_active ? <>
          {/* A stopped download goes on from the step it reached, through the Download Manager (no plugin needed);
              without one, the transfer starts again from the catalog. */}
          {game.resume_step ? <IconAction label={game.resume_step === "extract" ? c.resumeExtract : c.resumeDownload} tone="accent" disabled={busy} onClick={() => void digitalDownloadService.retry(catalogGame ?? asGame(game)).then(() => scanLibrary(), failure => notify(translate("toastActionFailed", { error: String(failure instanceof Error ? failure.message : failure) }), { tone: "error" }))}><Play /></IconAction>
            : <IconAction label={!catalogGame ? c.cannotResume : game.transfer_kind === "pieces" ? c.resumePieces : c.resumeOther} tone="accent" disabled={!catalogGame || busy} onClick={() => catalogGame && onInstall?.(catalogGame)}><Play /></IconAction>}
          {game.partial ? <IconAction label={c.restart} disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: true })}><RotateCcw /></IconAction> : null}
          <IconAction label={c.discardAll} tone="danger" disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: false })}><Trash2 /></IconAction>
          <IconAction label={c.openDownloadFolder} disabled={libraryDemo()} onClick={() => void digitalProcessManager.openFolder(asGame(game), "download")}><FolderOpen /></IconAction>
        </> : game.partial || game.transfer_active ? <IconAction label={c.openDownloadFolder} disabled={libraryDemo()} onClick={() => void digitalProcessManager.openFolder(asGame(game), "download")}><FolderOpen /></IconAction> : <>
          {isSteamOwned(game) ? <IconAction label={translate("steamInstallMenu")} tone="accent" disabled={busy} onClick={() => onInstall?.(catalogGame ?? asGame(game))}><Download /></IconAction> : null}
          {needsFix(game) && id != null ? <IconAction label={c.fix} tone="accent" disabled={busy} onClick={() => void askPlan([id])}><Wand2 /></IconAction> : null}
          {game.installed && game.frozen !== "deep" && catalogGame && onPlay ? <IconAction label={c.play} disabled={busy} onClick={() => void onPlay(catalogGame)}><Play /></IconAction> : null}
          {game.frozen && !game.linked && id != null ? <ThawAction game={game} c={c} disabled={busy} onClick={() => setThawing(game, "thaw")} /> : null}
          {!game.frozen && !game.linked && game.installed && id != null ? <>
            <IconAction label={c.freeze} tone="frost" disabled={busy} onClick={() => setThawing(game, "freeze")}><Snowflake /></IconAction>
            <IconAction label={c.deepFrozen} tone="frost" disabled={busy} onClick={() => setThawing(game, "deep")}><Snowflake /><b>+</b></IconAction>
          </> : null}
          <IconAction label={c.history} onClick={() => setExpanded(open ? null : id)}><ScrollText /></IconAction>
          <IconAction label={c.openFolder} disabled={libraryDemo() || isSteamOwned(game)} onClick={() => void digitalProcessManager.openFolder(asGame(game))}><FolderOpen /></IconAction>
          <IconAction label={game.linked ? c.unlink : c.uninstall} tone="danger" disabled={busy || id == null} onClick={() => id != null && setPending({ kind: "uninstall", ids: [id] })}><Trash2 /></IconAction>
        </>}
      </td>
    </tr>
    {open ? <tr className="lm-detail-row"><td colSpan={columns}><div className="lm-detail">
      {game.issues.length && !game.unfinished ? <div><b>{c.whatNeeds}</b>
        <ul>{game.issues.map(issue => <li key={issue.code}><AlertTriangle />{issue.message}{issue.bytes ? <em>({formatBytes(issue.bytes)})</em> : null}</li>)}</ul></div> : null}
      {!game.partial ? <div><b>{c.historyTitle}</b><History game={game} c={c} /></div> : null}
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
      <td><KindCell kind={row.kind} /></td>
      <td className="lm-cell-source">—</td>
      <td className="lm-cell-num">—</td>
      <td className="lm-cell-num">—</td>
      <td className="lm-acts">
        {onInstall ? <IconAction label={c.install} tone="accent" onClick={() => onInstall(game)}><Download /></IconAction> : null}
        <IconAction label={c.unlink} tone="danger" onClick={() => libraryMembership.remove(game)}><Link2Off /></IconAction>
      </td>
    </tr>
  );
}

/** A column header that sorts: one click sorts, the next one reverses; the arrow says which way. */
function SortHeader({ id, label, sort, setSort, t }: { id: SortKey; label: string; sort: Sort; setSort: (sort: Sort) => void; t: Translate }) {
  const active = sort.key === id;
  const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className={`lm-sort${active ? " is-active" : ""}`} title={t("lmSortBy", { column: label })}
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
  const runBatch = async (action: "adopt" | "uninstall" | "discard_transfer", ids: number[]) => {
    setBusy(true); setMessage(c.working);
    try {
      const results = libraryDemo() ? ids.map(app_id => ({ app_id, ok: true })) : (await digitalProcessManager.libraryBatch(action, ids)).results ?? [];
      if (action === "adopt" && !libraryDemo()) results.forEach(row => { const found = games.find(game => game.app_id === row.app_id); if (row.ok && found) addReadyGameToLibrary(row.app_id, found.name, catalog); });
      setMessage(c.done(results.filter(row => row.ok).length, results.filter(row => !row.ok).length));
      announceBatch(action, results, games);
      setSelection({});
    } catch (failure) { setMessage(String(failure)); notify(translate("toastActionFailed", { error: String(failure) }), { tone: "error" }); } finally { setBusy(false); setPending(null); await scanLibrary(); notifyLibraryChanged(); }
  };
  const confirmPending = async (current: Pending | null = pending) => {
    if (!current) return;
    if (current.kind === "plan") await runBatch("adopt", current.ids);
    else if (current.kind === "uninstall") await runBatch("uninstall", current.ids);
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
    const one = pending.kind === "uninstall" && pending.ids.length === 1 ? games.find(game => game.app_id === pending.ids[0]) : pending.kind === "discard" ? pending.game : undefined;
    const allLinked = pending.kind === "uninstall" && pending.ids.every(id => linkedIds.has(id));
    const anyLinked = pending.kind === "uninstall" && pending.ids.some(id => linkedIds.has(id));
    let live = true;
    void confirmNotice({
      game: one ? noticeGame(findCatalogGame(one) ?? asGame(one)) : undefined,
      title: pending.kind === "uninstall" ? (allLinked ? c.unlinkTitle(pending.ids.length) : c.uninstallTitle(pending.ids.length)) : c.discardTitle,
      text: pending.kind === "uninstall" ? (allLinked ? c.unlinkBody : anyLinked ? `${c.uninstallBody} ${c.unlinkNote}` : c.uninstallBody) : pending.restart ? c.restartBody : c.discardBody,
      confirmLabel: pending.kind === "uninstall" ? (allLinked ? c.unlink : c.uninstall) : pending.restart ? c.restart : c.discard,
      cancelLabel: c.cancel, kind: "danger",
    }).then(ok => { if (!live) return; if (ok) void confirmPending(pending); else setPending(null); });
    return () => { live = false; };
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const [escapeGuard, setEscapeGuard] = useState(false);
  useEffect(() => setEscapeGuard(Boolean(pending) || importOpen || Boolean(freezing)), [pending, importOpen, freezing]);
  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !escapeGuard) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escapeGuard, onClose, embedded]);

  const filters: [Filter, string, number][] = ([["all", c.all, counts.all], ["outside", c.outside, counts.outside], ["errors", c.errors, counts.errors], ["partial", c.partial, counts.partial], ["frozen", c.frozenFilter, counts.frozen]] as [Filter, string, number][]).filter(([id, , count]) => id === "all" || id === filter || count > 0);
  const installedCount = rows.filter(game => game.installed && !game.partial && !isUnfinished(game) && !game.unfinished).length;
  const absent = filter === "all" ? members.filter(member => !games.some(game => game.app_id === (member.app_id ?? member.id)) && matches(member.name, member.app_id ?? member.id)) : [];
  const gridRows: GridRow[] = [
    ...rows.map(game => ({ key: String(game.app_id ?? game.folder), name: game.name, status: statusOf(game, c, t), path: isSteamOwned(game) ? "" : game.folder, size: sizeOf(game), kind: kindOf(game), source: sourceOf(game), plays: game.plays ?? 0, last: game.last_played ?? "", game })),
    ...absent.map(member => ({ key: `member-${member.app_id ?? member.id}`, name: member.name, status: { rank: 11, label: t("lmStatusNoFolder"), tone: "muted" as const }, path: "", size: 0, kind: "dd" as const, source: "", plays: 0, last: "", member })),
  ].sort(compareRows(sort));
  const columns = 11;
  const selectable = rows.filter(game => game.app_id != null).map(game => String(game.app_id));
  const allSelected = selectable.length > 0 && selectable.every(key => selection[key]);
  const frozenStored = games.reduce((total, game) => total + (game.frozen ? game.frozen_bytes ?? game.size_bytes ?? 0 : 0), 0);
  const rowProps = { c, busy, locale, columns, expanded, setExpanded, selection, setSelection, largest, findCatalogGame, onInstall, onPlay, askPlan, setPending, setThawing: (game: LibraryGame, mode: FreezeMode) => setFreezing({ game, mode }), focusId: focusAppId ?? null };

  return (
    <TooltipProvider delayDuration={150}>
      <div className={embedded ? "lm-root is-embedded" : "lm-root fixed inset-x-0 bottom-0 top-[var(--window-chrome-height,34px)] z-[600] overflow-y-auto bg-background"} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-label={c.title}>
        {embedded ? null : <header className="ga-screen-header !max-w-none"><h2 className="ga-screen-title mr-auto">{c.title}</h2><GaBack label={c.back} onClick={onClose} data-dialog-initial /></header>}
        <div className="lm-content">
          <div className="lm-top">
          {summary ? <section className="lm-summary">
            <DiskDonut summary={summary} frozenBytes={frozenStored} c={c} />
            <div className="lm-stats">
              <div><strong>{installedCount}</strong><span>{c.installedStat}</span></div>
              <div><strong>{formatBytes(summary.frozen_saved_bytes ?? 0)}</strong><span>{c.frozenStat}</span></div>
            </div>
          </section> : null}
          <div className="lm-actions">
            <GaButton variant="primary" icon={<Wand2 size={16} />} disabled={busy || !fixable.length} onClick={() => void askPlan(fixable)}>{c.fixAll} ({fixable.length})</GaButton>
            <GaButton icon={<FolderInput size={16} />} disabled={busy} onClick={() => setImportOpen(true)}>{c.importGames}</GaButton>
            <GaButton icon={<Gamepad2 size={16} />} disabled={busy} onClick={() => void importSteam()}>{t("steamImportNow")}</GaButton>
          </div>
          </div>
          <div className="lm-filters">
            {filters.map(([id, label, count]) => <button key={id} type="button" className="lm-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{count}</span></button>)}
            <GaButton className="lm-icon-button lm-scan" aria-label={scanning ? c.scanning : c.scan} title={scanning ? c.scanning : c.scan} disabled={busy || scanning} onClick={() => void scanLibrary()}>{scanning ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />}</GaButton>
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
                <SortHeader id="source" label={t("lmColSource")} sort={sort} setSort={setSort} t={t} />
                <SortHeader id="plays" label={t("lmColPlays")} sort={sort} setSort={setSort} t={t} />
                <SortHeader id="last" label={t("lmColLastPlayed")} sort={sort} setSort={setSort} t={t} />
                <th className="lm-cell-acts"><span className="sr-only">{t("lmColActions")}</span></th>
              </tr></thead>
              <tbody>
                {gridRows.map(row => row.game ? <ManagerRow key={row.key} row={row} game={row.game} {...rowProps} /> : row.member ? <AbsentRow key={row.key} row={row} game={row.member} c={c} onInstall={onInstall} /> : null)}
              </tbody>
            </table> : <p className="lm-empty">{games.length || members.length ? c.empty : scanning ? c.scanning : c.noGames}</p>}
          </div>
        </div>
      </div>

      {freezing ? <FreezeDialog game={findCatalogGame(freezing.game) ?? asGame(freezing.game)} mode={freezing.mode} onClose={() => setFreezing(null)} /> : null}
      {importOpen ? <ImportWizard catalog={catalog} c={c} onClose={imported => { setImportOpen(false); if (imported) { void scanLibrary(); notifyLibraryChanged(); } }} /> : null}
      {pending?.kind === "plan" ? <PlanDialog plans={pending.plans} c={c} busy={busy} onConfirm={() => void confirmPending()} onCancel={() => setPending(null)} /> : null}
    </TooltipProvider>
  );
}
