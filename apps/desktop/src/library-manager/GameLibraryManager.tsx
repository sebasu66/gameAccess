import { useEffect, useMemo, useRef, useState } from "react";
import CircularScrollbar from "../CircularScrollbar";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type RowSelectionState, type SortingState } from "@tanstack/react-table";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, FolderOpen, Loader2, Play, RotateCcw, ScanSearch, ScrollText, Trash2, Wand2, X } from "lucide-react";
import { useI18n } from "../i18n";
import SteamCover from "../SteamCover";
import { digitalProcessManager, type LibraryGame, type LibraryPlan } from "../catalog/DigitalProcessManager";
import { libraryDemo, scanLibrary, useLibraryScan } from "../libraryScan";
import type { CatalogGame } from "../types";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Progress } from "../components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/cn";
import { DiskBar } from "./Charts";
import { copy, type LibraryCopy } from "./copy";
import { demoPlans } from "./demoData";
import { formatBytes } from "./format";
import { PlanDialog } from "./PlanDialog";

type Filter = "all" | "outside" | "errors" | "partial";
type Pending =
  | { kind: "plan"; plans: LibraryPlan[]; ids: number[] }
  | { kind: "uninstall"; ids: number[] }
  | { kind: "discard"; game: LibraryGame; restart: boolean };

const asGame = (game: LibraryGame): CatalogGame => ({ id: game.app_id, app_id: game.app_id, name: game.name } as CatalogGame);
const hasError = (game: LibraryGame) => game.issues.some(issue => issue.code === "error");
const isUnfinished = (game: LibraryGame) => Boolean(game.partial) || (Boolean(game.transfer_bytes) && !game.transfer_active);
const needsFix = (game: LibraryGame) => !game.standard && !game.partial;

function StatusBadges({ game, c }: { game: LibraryGame; c: LibraryCopy }) {
  const badges = [] as JSX.Element[];
  if (game.partial) badges.push(game.transfer_active ? <Badge key="s" variant="info"><Loader2 className="size-3 animate-spin" />{c.downloading}</Badge> : <Badge key="s" variant="info">{c.partialDl}</Badge>);
  else if (hasError(game)) badges.push(<Badge key="s" variant="destructive"><AlertTriangle className="size-3" />{c.error}</Badge>);
  else if (!game.standard) badges.push(<Badge key="s" variant="warning"><AlertTriangle className="size-3" />{c.outsideStd}</Badge>);
  else if (["installing", "downloading", "preparing"].includes(game.state)) badges.push(<Badge key="s" variant="info"><Loader2 className="size-3 animate-spin" />{c[game.state as "installing"]}</Badge>);
  else badges.push(<Badge key="s" variant="success">{c.ready}</Badge>);
  if (!game.partial && game.transfer_bytes && !game.transfer_active) badges.push(<Badge key="t" variant="info">{c.partialDl} · {formatBytes(game.transfer_bytes)}</Badge>);
  return <div className="flex flex-wrap items-center gap-1.5">{badges}</div>;
}

function subline(game: LibraryGame, c: LibraryCopy): string {
  if (game.partial) return `${c.partialDl}: ${formatBytes(game.transfer_bytes)}`;
  if (!game.standard) return game.issues[0]?.message ?? game.warning;
  if (game.last_played) return game.last_played.slice(0, 10);
  return "";
}

function IconAction({ label, onClick, disabled, destructive, children }: { label: string; onClick: () => void; disabled?: boolean; destructive?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick} className={destructive ? "hover:bg-destructive/20 hover:text-[#ff6b75]" : undefined}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function History({ game, c }: { game: LibraryGame; c: LibraryCopy }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (libraryDemo()) { setText("2026-10-12 21:04:11 | importado | carpeta adaptada al estándar actual\n2026-10-12 21:04:12 | analisis | estado=ready; ejecutable=Game/game.exe"); return; }
    void digitalProcessManager.gameLog(asGame(game)).then(result => { if (live) setText(result.log ?? ""); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [game.app_id]);
  return <pre className="m-0 max-h-48 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-muted-foreground">{text === null ? c.working : text || c.noHistory}</pre>;
}

export default function GameLibraryManager({ onClose, catalog = [], onInstall }: { onClose: () => void; catalog?: CatalogGame[]; onInstall?: (game: CatalogGame) => void }) {
  const { locale } = useI18n(); const c = copy[locale] ?? copy.es;
  const { games, summary, scanning, error } = useLibraryScan();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "size", desc: true }]);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void scanLibrary(); }, []);

  const counts = useMemo(() => ({ all: games.length, outside: games.filter(needsFix).length, errors: games.filter(hasError).length, partial: games.filter(isUnfinished).length }), [games]);
  const rows = useMemo(() => games.filter(game => {
    if (query && !game.name.toLowerCase().includes(query.toLowerCase())) return false;
    return filter === "all" || (filter === "outside" && needsFix(game)) || (filter === "errors" && hasError(game)) || (filter === "partial" && isUnfinished(game));
  }), [games, filter, query]);
  const largest = useMemo(() => Math.max(1, ...games.map(game => game.size_bytes ?? 0)), [games]);
  const selectedIds = useMemo(() => rows.filter(game => game.app_id != null && selection[String(game.app_id)]).map(game => game.app_id as number), [rows, selection]);
  const fixable = useMemo(() => games.filter(needsFix).map(game => game.app_id as number), [games]);
  const selectedFixable = selectedIds.filter(id => fixable.includes(id));

  const findCatalogGame = (game: LibraryGame) => catalog.find(item => (item.app_id ?? item.id) === game.app_id);

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
      setMessage(c.done(results.filter(row => row.ok).length, results.filter(row => !row.ok).length));
      setSelection({});
    } catch (failure) { setMessage(String(failure)); } finally { setBusy(false); setPending(null); await scanLibrary(); }
  };
  const confirmPending = async () => {
    if (!pending) return;
    if (pending.kind === "plan") await runBatch("adopt", pending.ids);
    else if (pending.kind === "uninstall") await runBatch("uninstall", pending.ids);
    else {
      const catalogGame = findCatalogGame(pending.game);
      await runBatch("discard_transfer", [pending.game.app_id as number]);
      if (pending.restart && catalogGame && onInstall) onInstall(catalogGame);
    }
  };

  const columns = useMemo<ColumnDef<LibraryGame>[]>(() => [
    {
      id: "select", enableSorting: false,
      header: ({ table }) => <Checkbox aria-label="all" checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false} onCheckedChange={value => table.toggleAllRowsSelected(Boolean(value))} />,
      cell: ({ row }) => <Checkbox aria-label={row.original.name} checked={row.getIsSelected()} onCheckedChange={value => row.toggleSelected(Boolean(value))} />,
    },
    {
      id: "name", accessorFn: game => game.name.toLowerCase(), header: c.game,
      cell: ({ row }) => {
        const game = row.original; const open = expanded === game.app_id;
        return (
          <button type="button" className="flex w-full items-center gap-3 border-0 bg-transparent p-0 text-left text-foreground" onClick={() => setExpanded(open ? null : game.app_id)} aria-expanded={open}>
            <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded-sm bg-muted [&_*]:max-h-full"><SteamCover game={asGame(game)} /></span>
            <span className="grid min-w-0 gap-0.5">
              <span className="flex items-center gap-1 truncate text-sm font-bold">{open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}{game.name}</span>
              <span className={cn("truncate text-xs", needsFix(game) ? "text-warning" : "text-muted-foreground")}>{subline(game, c)}</span>
            </span>
          </button>
        );
      },
    },
    {
      id: "size", accessorFn: game => (game.size_bytes ?? 0) + (game.transfer_bytes ?? 0), header: c.size,
      cell: ({ row }) => {
        const game = row.original; const value = game.partial ? game.transfer_bytes ?? 0 : game.size_bytes ?? 0;
        return <div className="grid w-40 gap-1"><span className="text-sm font-bold tabular-nums">{formatBytes(value)}</span><Progress value={(value / Math.max(largest, game.transfer_bytes ?? 0)) * 100} indicatorClassName={game.partial ? "bg-info" : undefined} /></div>;
      },
    },
    { id: "status", enableSorting: false, header: c.status, cell: ({ row }) => <StatusBadges game={row.original} c={c} /> },
    { id: "plays", accessorFn: game => game.plays ?? 0, header: c.plays, cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.plays ?? 0}</span> },
    {
      id: "actions", enableSorting: false, header: () => <span className="sr-only">{c.actions}</span>,
      cell: ({ row }) => {
        const game = row.original; const id = game.app_id;
        const catalogGame = findCatalogGame(game);
        return (
          <div className="flex items-center justify-end gap-0.5">
            {game.partial && !game.transfer_active ? <>
              <IconAction label={catalogGame ? c.resume : c.cannotResume} disabled={!catalogGame || busy} onClick={() => catalogGame && onInstall?.(catalogGame)}><Play /></IconAction>
              <IconAction label={c.restart} disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: true })}><RotateCcw /></IconAction>
              <IconAction label={c.discard} destructive disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: false })}><Trash2 /></IconAction>
            </> : game.partial ? null : <>
              {needsFix(game) && id != null ? <IconAction label={c.fix} disabled={busy} onClick={() => void askPlan([id])}><Wand2 className="text-primary" /></IconAction> : null}
              {game.transfer_bytes && !game.transfer_active ? <IconAction label={c.discard} disabled={busy} onClick={() => setPending({ kind: "discard", game, restart: false })}><RotateCcw /></IconAction> : null}
              <IconAction label={c.history} onClick={() => setExpanded(expanded === id ? null : id)}><ScrollText /></IconAction>
              <IconAction label={c.openFolder} disabled={libraryDemo()} onClick={() => void digitalProcessManager.openFolder(asGame(game))}><FolderOpen /></IconAction>
              <IconAction label={c.uninstall} destructive disabled={busy || id == null} onClick={() => id != null && setPending({ kind: "uninstall", ids: [id] })}><Trash2 /></IconAction>
            </>}
          </div>
        );
      },
    },
  ], [c, expanded, largest, busy, catalog, onInstall]);

  const table = useReactTable({
    data: rows, columns, state: { sorting, rowSelection: selection }, onSortingChange: setSorting, onRowSelectionChange: setSelection,
    getRowId: game => String(game.app_id ?? game.folder), getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), enableRowSelection: game => game.original.app_id != null,
  });

  const [escapeGuard, setEscapeGuard] = useState(false);
  useEffect(() => setEscapeGuard(Boolean(pending)), [pending]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !escapeGuard) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escapeGuard, onClose]);

  const stat = (label: string, value: string, tone = "") => <div className="grid gap-0.5 rounded-lg border border-border bg-card px-4 py-2.5"><span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span><span className={cn("font-sans text-xl font-extrabold tabular-nums", tone)}>{value}</span></div>;
  const filters: [Filter, string, number][] = [["all", c.all, counts.all], ["outside", c.outside, counts.outside], ["errors", c.errors, counts.errors], ["partial", c.partial, counts.partial]];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="fixed inset-x-0 bottom-0 top-[var(--window-chrome-height,34px)] z-[600] flex flex-col overflow-y-auto bg-background [color-scheme:dark] font-sans text-foreground" role="dialog" aria-modal="true" aria-label={c.title}>
        <header className="ga-screen-header">
          <Button variant="outline" onClick={onClose} data-dialog-initial><ArrowLeft />{c.back}</Button>
          <h2 className="ga-screen-title mr-auto">{c.title}</h2>
          <Button variant="secondary" disabled={busy || scanning} onClick={() => void scanLibrary()}>{scanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}{scanning ? c.scanning : c.scan}</Button>
          <Button variant="default" disabled={busy || !fixable.length} onClick={() => void askPlan(fixable)}><Wand2 />{c.fixAll} ({fixable.length})</Button>
        </header>
        <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col gap-4 px-12 pb-6">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input className="max-w-64" placeholder={c.search} value={query} onChange={event => setQuery(event.target.value)} aria-label={c.search} />
              <div className="flex flex-wrap gap-1.5">
                {filters.map(([id, label, count]) => (
                  <Button key={id} size="sm" variant={filter === id ? "default" : "outline"} onClick={() => setFilter(id)}>{label}<span className="tabular-nums opacity-70">{count}</span></Button>
                ))}
              </div>
              {selectedIds.length ? <div className="ml-auto flex items-center gap-2 rounded-md border border-primary/60 bg-primary/10 px-3 py-1">
                <b className="text-xs">{c.selected(selectedIds.length)}</b>
                <Button size="sm" variant="default" disabled={busy || !selectedFixable.length} onClick={() => void askPlan(selectedFixable)}><Wand2 />{c.fixSelected}</Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => setPending({ kind: "uninstall", ids: selectedIds })}><Trash2 />{c.uninstall}</Button>
                <Button size="icon" variant="ghost" aria-label={c.clear} onClick={() => setSelection({})}><X /></Button>
              </div> : null}
            </div>
            {message ? <p role="status" className="m-0 rounded-md border border-border bg-card px-3 py-2 text-sm">{message}</p> : null}
            {error ? <p role="alert" className="m-0 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-[#ff6b75]">{error}</p> : null}
            <div className="relative min-h-[200px] flex-1 rounded-lg border border-border bg-card/40">
              <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden pr-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map(group => (
                    <TableRow key={group.id} className="hover:bg-transparent">
                      {group.headers.map(header => {
                        const sorted = header.column.getIsSorted();
                        return (
                          <TableHead key={header.id} className={header.column.id === "select" ? "w-10" : undefined}>
                            {header.isPlaceholder ? null : header.column.getCanSort()
                              ? <button type="button" className="inline-flex items-center gap-1 border-0 bg-transparent p-0 font-[inherit] text-[inherit] uppercase tracking-[inherit] text-muted-foreground hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                              </button>
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length === 0 ? <TableRow><TableCell colSpan={columns.length} className="py-10 text-center text-muted-foreground">{games.length ? c.empty : scanning ? c.scanning : c.noGames}</TableCell></TableRow> :
                    table.getRowModel().rows.flatMap(row => {
                      const game = row.original; const open = expanded === game.app_id;
                      return [
                        <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                          {row.getVisibleCells().map(cell => <TableCell key={cell.id} className={cell.column.id === "actions" ? "w-px whitespace-nowrap" : cell.column.id === "name" ? "min-w-[260px]" : undefined}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
                        </TableRow>,
                        open ? <TableRow key={`${row.id}-detail`} className="bg-background/60 hover:bg-background/60"><TableCell /><TableCell colSpan={columns.length - 1}>
                          <div className="grid gap-3 py-1">
                            {game.issues.length ? <div className="grid gap-1"><b className="text-xs uppercase tracking-wider text-muted-foreground">{c.whatNeeds}</b>
                              <ul className="m-0 grid list-none gap-1 p-0">{game.issues.map(issue => <li key={issue.code} className="flex items-center gap-2 text-sm"><AlertTriangle className="size-3.5 text-warning" />{issue.message}{issue.bytes ? <b className="text-xs text-muted-foreground">({formatBytes(issue.bytes)})</b> : null}</li>)}</ul></div> : null}
                            {!game.partial ? <div className="grid gap-1"><b className="text-xs uppercase tracking-wider text-muted-foreground">{c.historyTitle}</b><History game={game} c={c} /></div> : null}
                          </div>
                        </TableCell></TableRow> : null,
                      ];
                    })}
                </TableBody>
              </Table>
              </div>
              <CircularScrollbar targetRef={scrollRef} label={c.title} />
            </div>
          </section>
          {summary ? <div className="grid flex-none gap-3">
            <div className="grid grid-cols-5 gap-3 max-[900px]:grid-cols-2">
              {stat(c.games, String(summary.count))}
              {stat(c.used, formatBytes(summary.used_bytes))}
              {stat(c.partialStat, formatBytes(summary.transfers_bytes), summary.transfers_bytes ? "text-info" : "")}
              {stat(c.broken, String(summary.nonstandard), summary.nonstandard ? "text-warning" : "")}
              {stat(c.reclaim, formatBytes(summary.reclaimable_bytes), summary.reclaimable_bytes ? "text-warning" : "")}
            </div>
            <DiskBar summary={summary} c={c} />
          </div> : null}
        </div>
      </div>

      {pending?.kind === "plan" ? <PlanDialog plans={pending.plans} c={c} busy={busy} onConfirm={() => void confirmPending()} onCancel={() => setPending(null)} /> : null}
      {pending && pending.kind !== "plan" ? (
        <AlertDialog open onOpenChange={open => { if (!open && !busy) setPending(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{pending.kind === "uninstall" ? c.uninstallTitle(pending.ids.length) : c.discardTitle}</AlertDialogTitle>
              <AlertDialogDescription>{pending.kind === "uninstall" ? c.uninstallBody : pending.restart ? c.restartBody : c.discardBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>{c.cancel}</AlertDialogCancel>
              <AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void confirmPending(); }}>{busy ? c.working : pending.kind === "uninstall" ? c.uninstall : pending.restart ? c.restart : c.discard}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </TooltipProvider>
  );
}
