import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Flame, FolderInput, FolderOpen, Link2Off, Loader2, Play, RotateCcw, ScanSearch, ScrollText, Snowflake, Trash2, Wand2, X } from "lucide-react";
import { translate, useI18n } from "../i18n";
import { notify } from "../toasts";
import { digitalProcessManager, type LibraryGame, type LibraryPlan } from "../catalog/DigitalProcessManager";
import { libraryDemo, scanLibrary, useLibraryScan } from "../libraryScan";
import type { CatalogGame } from "../types";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { DiskDonut } from "./Charts";
import { copy, type LibraryCopy } from "./copy";
import { demoPlans } from "./demoData";
import { formatBytes } from "./format";
import { ImportWizard } from "./ImportWizard";
import { addReadyGameToLibrary, libraryMembership, useLibraryGames } from "../libraryMembership";
import { PlanDialog } from "./PlanDialog";
import { SizeCell } from "./SizeCell";
import FreezeDialog, { type FreezeMode } from "../FreezeDialog";
import { useFreezeJob } from "../freezeJobs";
import { GaBack, GaButton } from "../components/ga/Buttons";
import { confirmNotice } from "../notice/notice";
import { noticeGame } from "../notice/noticeGame";
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

/**
 * What a row says about its state, without repeating text (docs/TAREA-interfaz-nueva.md T11): ready → nothing;
 * frozen → the grid's snowflake; outside the standard or with an error → a warning icon; both with their name on
 * hover or focus. Downloads keep a short badge.
 */
function RowState({ game, c }: { game: LibraryGame; c: LibraryCopy }) {
  const flag = (kind: "frost" | "warn", label: string, icon: JSX.Element) => <span className={`lm-state ${kind}`} tabIndex={0} role="img" aria-label={label}>{icon}<i>{label}</i></span>;
  if (game.frozen) return flag("frost", game.frozen === "deep" ? c.deepFrozen : c.frozen, <Snowflake />);
  if (game.linked) return <span className="lm-badge">{c.linked}</span>;
  if (game.partial || game.unfinished || isUnfinished(game)) {
    if (game.transfer_active) return <span className="lm-badge"><Loader2 className="animate-spin" />{c.downloading}</span>;
    if (game.queued) return <span className="lm-badge">{c.queued}</span>;
    return <span />;
  }
  if (hasError(game)) return flag("warn", c.error, <AlertTriangle />);
  if (!game.standard) return flag("warn", c.outsideStd, <AlertTriangle />);
  if (["installing", "downloading", "preparing"].includes(game.state)) return <span className="lm-badge"><Loader2 className="animate-spin" />{c[game.state as "installing"]}</span>;
  return <span />;
}

function subline(game: LibraryGame, c: LibraryCopy): string {
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

type RowProps = {
  game: LibraryGame; c: LibraryCopy; busy: boolean; largest: number; focusId: number | null;
  expanded: number | null; setExpanded: (id: number | null) => void;
  selection: Selection; setSelection: (update: (current: Selection) => Selection) => void;
  findCatalogGame: (game: LibraryGame) => CatalogGame | undefined;
  onInstall?: (game: CatalogGame) => void; onPlay?: (game: CatalogGame) => void | Promise<void>;
  askPlan: (ids: number[]) => Promise<void>; setPending: (pending: Pending) => void; setThawing: (game: LibraryGame, mode: FreezeMode) => void;
};

/** A compact row: landscape picture, name, a status line only when it adds something, size, state icon; the actions
 *  appear on hover or focus. */
function ManagerRow({ game, c, busy, largest, focusId, expanded, setExpanded, selection, setSelection, findCatalogGame, onInstall, onPlay, askPlan, setPending, setThawing }: RowProps) {
  const id = game.app_id;
  const key = String(id ?? game.folder);
  const open = expanded === id;
  const catalogGame = findCatalogGame(game);
  const line = subline(game, c);
  const unfinished = game.partial || isUnfinished(game);
  const ref = useRef<HTMLDivElement>(null);
  const focused = focusId != null && focusId === id;
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focused]);
  return (
    <div ref={ref} className={`lm-row${focused ? " is-focus" : ""}${selection[key] ? " is-selected" : ""}`} data-app-id={id ?? undefined}>
      <span className={`lm-thumb${game.frozen ? " is-frozen" : ""}`}>
        {id ? <img src={landscape(id)} alt="" loading="lazy" /> : null}
        {id != null ? <input type="checkbox" className="lm-check" aria-label={game.name} checked={Boolean(selection[key])} onChange={event => { const value = event.target.checked; setSelection(current => ({ ...current, [key]: value })); }} /> : null}
      </span>
      <div className="lm-main">
        <div className="lm-name">{game.name}</div>
        {line ? <div className={`lm-line${!game.standard && !game.unfinished ? " warn" : ""}`}>{line}</div> : null}
        <SizeCell game={game} largest={largest} c={c} />
      </div>
      <RowState game={game} c={c} />
      <div className="lm-acts">
        {unfinished && !game.transfer_active ? <>
          <IconAction label={!catalogGame ? c.cannotResume : game.transfer_kind === "pieces" ? c.resumePieces : c.resumeOther} tone="accent" disabled={!catalogGame || busy} onClick={() => catalogGame && onInstall?.(catalogGame)}><Play /></IconAction>
          {game.partial ? <IconAction label={c.restart} disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: true })}><RotateCcw /></IconAction> : null}
          <IconAction label={c.discardAll} tone="danger" disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: false })}><Trash2 /></IconAction>
          {!game.partial ? <IconAction label={c.openFolder} disabled={libraryDemo()} onClick={() => void digitalProcessManager.openFolder(asGame(game))}><FolderOpen /></IconAction> : null}
        </> : game.partial || game.transfer_active ? null : <>
          {needsFix(game) && id != null ? <IconAction label={c.fix} tone="accent" disabled={busy} onClick={() => void askPlan([id])}><Wand2 /></IconAction> : null}
          {game.installed && game.frozen !== "deep" && catalogGame && onPlay ? <IconAction label={c.play} disabled={busy} onClick={() => void onPlay(catalogGame)}><Play /></IconAction> : null}
          {game.frozen && !game.linked && id != null ? <ThawAction game={game} c={c} disabled={busy} onClick={() => setThawing(game, "thaw")} /> : null}
          {!game.frozen && !game.linked && game.installed && id != null ? <>
            <IconAction label={c.freeze} tone="frost" disabled={busy} onClick={() => setThawing(game, "freeze")}><Snowflake /></IconAction>
            <IconAction label={c.deepFrozen} tone="frost" disabled={busy} onClick={() => setThawing(game, "deep")}><Snowflake /><b>+</b></IconAction>
          </> : null}
          <IconAction label={c.history} onClick={() => setExpanded(open ? null : id)}><ScrollText /></IconAction>
          <IconAction label={c.openFolder} disabled={libraryDemo()} onClick={() => void digitalProcessManager.openFolder(asGame(game))}><FolderOpen /></IconAction>
          <IconAction label={game.linked ? c.unlink : c.uninstall} tone="danger" disabled={busy || id == null} onClick={() => id != null && setPending({ kind: "uninstall", ids: [id] })}><Trash2 /></IconAction>
        </>}
      </div>
      {open ? <div className="lm-detail">
        {game.issues.length && !game.unfinished ? <div><b>{c.whatNeeds}</b>
          <ul>{game.issues.map(issue => <li key={issue.code}><AlertTriangle />{issue.message}{issue.bytes ? <em>({formatBytes(issue.bytes)})</em> : null}</li>)}</ul></div> : null}
        {!game.partial ? <div><b>{c.historyTitle}</b><History game={game} c={c} /></div> : null}
      </div> : null}
    </div>
  );
}

/** A game of the library with no folder yet: Install, or take it out of the library. */
function AbsentRow({ game, c, onInstall }: { game: CatalogGame; c: LibraryCopy; onInstall?: (game: CatalogGame) => void }) {
  return (
    <div className="lm-row">
      <span className="lm-thumb">{game.app_id ? <img src={landscape(game.app_id)} alt="" loading="lazy" /> : null}</span>
      <div className="lm-main"><div className="lm-name">{game.name}</div></div>
      <span />
      <div className="lm-acts">
        {onInstall ? <IconAction label={c.install} tone="accent" onClick={() => onInstall(game)}><Download /></IconAction> : null}
        <IconAction label={c.unlink} tone="danger" onClick={() => libraryMembership.remove(game)}><Link2Off /></IconAction>
      </div>
    </div>
  );
}

export default function GameLibraryManager({ onClose, catalog = [], onInstall, onPlay, focusAppId, embedded = false }: {
  onClose: () => void; catalog?: CatalogGame[]; onInstall?: (game: CatalogGame) => void; onPlay?: (game: CatalogGame) => void | Promise<void>;
  /** Highlights this game's row and scrolls to it ("Manage" on the back of a library card). */
  focusAppId?: number | null;
  /** Inside a desk panel (T10): the panel draws the title and the close button and handles Esc. */
  embedded?: boolean;
}) {
  const { locale } = useI18n(); const c = copy[locale] ?? copy.es;
  const { games, summary, scanning, error } = useLibraryScan();
  const members = useLibraryGames();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [freezing, setFreezing] = useState<{ game: LibraryGame; mode: FreezeMode } | null>(null);
  useEffect(() => { void scanLibrary(); }, []);
  useEffect(() => { if (focusAppId != null) { setFilter("all"); setQuery(""); } }, [focusAppId]);

  const counts = useMemo(() => ({ all: games.length, outside: games.filter(needsFix).length, errors: games.filter(hasError).length, partial: games.filter(isUnfinished).length, frozen: games.filter(game => game.frozen).length }), [games]);
  const rows = useMemo(() => games.filter(game => {
    if (query && !game.name.toLowerCase().includes(query.toLowerCase())) return false;
    return filter === "all" || (filter === "outside" && needsFix(game)) || (filter === "errors" && hasError(game)) || (filter === "partial" && isUnfinished(game)) || (filter === "frozen" && Boolean(game.frozen));
  }), [games, filter, query]);
  const sorted = useMemo(() => [...rows].sort((a, b) => ((b.size_bytes ?? 0) + (b.transfer_bytes ?? 0)) - ((a.size_bytes ?? 0) + (a.transfer_bytes ?? 0))), [rows]);
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
  const installed = sorted.filter(game => game.installed && !game.partial && !isUnfinished(game) && !game.unfinished);
  const notInstalled = sorted.filter(game => !installed.includes(game));
  const absent = filter === "all" ? members.filter(member => !games.some(game => game.app_id === (member.app_id ?? member.id)) && (!query || member.name.toLowerCase().includes(query.toLowerCase()))) : [];
  const frozenStored = games.reduce((total, game) => total + (game.frozen ? game.frozen_bytes ?? game.size_bytes ?? 0 : 0), 0);
  const rowProps = { c, busy, expanded, setExpanded, selection, setSelection, largest, findCatalogGame, onInstall, onPlay, askPlan, setPending, setThawing: (game: LibraryGame, mode: FreezeMode) => setFreezing({ game, mode }), focusId: focusAppId ?? null };

  return (
    <TooltipProvider delayDuration={150}>
      <div className={embedded ? "lm-root is-embedded" : "lm-root fixed inset-x-0 bottom-0 top-[var(--window-chrome-height,34px)] z-[600] overflow-y-auto bg-background"} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-label={c.title}>
        {embedded ? null : <header className="ga-screen-header !max-w-none"><h2 className="ga-screen-title mr-auto">{c.title}</h2><GaBack label={c.back} onClick={onClose} data-dialog-initial /></header>}
        <div className="lm-content">
          {summary ? <section className="lm-summary">
            <DiskDonut summary={summary} frozenBytes={frozenStored} c={c} />
            <div className="lm-stats">
              <div><strong>{installed.length}</strong><span>{c.installedStat}</span></div>
              <div><strong>{formatBytes(summary.frozen_saved_bytes ?? 0)}</strong><span>{c.frozenStat}</span></div>
            </div>
          </section> : null}
          <div className="lm-actions">
            <GaButton variant="primary" icon={<Wand2 size={16} />} disabled={busy || !fixable.length} onClick={() => void askPlan(fixable)}>{c.fixAll} ({fixable.length})</GaButton>
            <GaButton icon={<FolderInput size={16} />} disabled={busy} onClick={() => setImportOpen(true)}>{c.importGames}</GaButton>
            <GaButton className="lm-icon-button" aria-label={scanning ? c.scanning : c.scan} title={scanning ? c.scanning : c.scan} disabled={busy || scanning} onClick={() => void scanLibrary()}>{scanning ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />}</GaButton>
          </div>
          <div className="lm-filters">
            <Input className="lm-search" placeholder={c.search} value={query} onChange={event => setQuery(event.target.value)} aria-label={c.search} />
            {filters.map(([id, label, count]) => <button key={id} type="button" className="lm-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{count}</span></button>)}
          </div>
          {selectedIds.length ? <div className="lm-selection">
            <b>{c.selected(selectedIds.length)}</b>
            <Button size="sm" variant="default" disabled={busy || !selectedFixable.length} onClick={() => void askPlan(selectedFixable)}><Wand2 />{c.fixSelected}</Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setPending({ kind: "uninstall", ids: selectedIds })}><Trash2 />{c.uninstall}</Button>
            <Button size="icon" variant="ghost" aria-label={c.clear} onClick={() => setSelection({})}><X /></Button>
          </div> : null}
          {message ? <p role="status" className="lm-message">{message}</p> : null}
          {error ? <p role="alert" className="lm-message is-error">{error}</p> : null}
          <div className="lm-list">
            {!installed.length && !notInstalled.length && !absent.length ? <p className="lm-empty">{games.length ? c.empty : scanning ? c.scanning : c.noGames}</p> : null}
            {installed.map(game => <ManagerRow key={game.app_id ?? game.folder} game={game} {...rowProps} />)}
          </div>
          {notInstalled.length || absent.length ? <>
            <h3 className="lm-section">{c.notInstalled} <b>{notInstalled.length + absent.length}</b></h3>
            <div className="lm-list">
              {notInstalled.map(game => <ManagerRow key={game.app_id ?? game.folder} game={game} {...rowProps} />)}
              {absent.map(member => <AbsentRow key={member.app_id ?? member.id} game={member} c={c} onInstall={onInstall} />)}
            </div>
          </> : null}
        </div>
      </div>

      {freezing ? <FreezeDialog game={findCatalogGame(freezing.game) ?? asGame(freezing.game)} mode={freezing.mode} onClose={() => setFreezing(null)} /> : null}
      {importOpen ? <ImportWizard catalog={catalog} c={c} onClose={imported => { setImportOpen(false); if (imported) { void scanLibrary(); notifyLibraryChanged(); } }} /> : null}
      {pending?.kind === "plan" ? <PlanDialog plans={pending.plans} c={c} busy={busy} onConfirm={() => void confirmPending()} onCancel={() => setPending(null)} /> : null}
    </TooltipProvider>
  );
}
