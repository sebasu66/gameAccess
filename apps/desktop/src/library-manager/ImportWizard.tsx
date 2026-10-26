import { GaButton, GaClose } from "../components/ga/Buttons";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, HardDrive, Link2, Loader2, MoveRight, ScanSearch, X } from "lucide-react";
import CircularScrollbar from "../CircularScrollbar";
import { digitalProcessManager, type ImportCandidate, type ImportDrive, type ImportItem } from "../catalog/DigitalProcessManager";
import { libraryDemo } from "../libraryScan";
import { queryCatalogCache } from "../catalogCache";
import { addReadyGameToLibrary } from "../libraryMembership";
import { notify } from "../toasts";
import { translate } from "../i18n";
import type { CatalogGame } from "../types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { cn } from "../lib/cn";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";
import { duplicateRows, suggest } from "./matching";

type Step = "drives" | "scanning" | "results" | "importing" | "done";
interface Row { candidate: ImportCandidate; choice: number | null; mode: "link" | "move"; picked: boolean; options: Array<{ id: number; name: string }> }

const demoDrives: ImportDrive[] = [{ path: "C:\\", label: "C:", total_bytes: 931 * 1024 ** 3, free_bytes: 240 * 1024 ** 3 }, { path: "D:\\", label: "D:", total_bytes: 1863 * 1024 ** 3, free_bytes: 1100 * 1024 ** 3 }];
const demoCandidates: ImportCandidate[] = [
  { id: "a", name: "Hades", path: "D:\\SteamLibrary\\steamapps\\common\\Hades", kind: "steam", source: "steam", app_id: 1145360, size_bytes: 15 * 1024 ** 3, executable: "", can_move: false },
  { id: "b", name: "Elden.Ring.v1.10-FitGirl", path: "D:\\Games\\Elden.Ring.v1.10-FitGirl", kind: "folder", source: "library", app_id: null, size_bytes: 52 * 1024 ** 3, executable: "eldenring.exe", can_move: true },
  { id: "c", name: "Mystery Folder", path: "C:\\Users\\me\\Downloads\\Mystery Folder", kind: "folder", source: "downloads", app_id: null, size_bytes: 3 * 1024 ** 3, executable: "go.exe", can_move: true },
];

/** Import wizard: choose disks → scan the usual places → review what was found → link in place or move into the library. */
export function ImportWizard({ catalog, c, onClose }: { catalog: CatalogGame[]; c: LibraryCopy; onClose: (imported: boolean) => void }) {
  const [step, setStep] = useState<Step>("drives");
  const [drives, setDrives] = useState<ImportDrive[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; error?: string }>>([]);
  const [cacheNames, setCacheNames] = useState<Map<number, string>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const imported = useRef(false);

  useEffect(() => {
    let live = true;
    const load = libraryDemo() ? Promise.resolve({ drives: demoDrives }) : digitalProcessManager.importDrives();
    void load.then(result => { if (live) { setDrives(result.drives ?? []); setChosen(new Set((result.drives ?? []).map(drive => drive.path))); } }).catch(error => live && setMessage(String(error)));
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && step !== "scanning" && step !== "importing") { event.stopPropagation(); onClose(imported.current); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, onClose]);

  const catalogName = useMemo(() => new Map(catalog.map(game => [(game.app_id ?? game.id) as number, game.name])), [catalog]);
  // A game found by its AppID takes the catalog's name for that AppID, never the folder's ("WRATH.Aeon.of.Ruin...").
  const nameOf = (appId: number) => catalogName.get(appId) ?? cacheNames.get(appId);

  const scan = async () => {
    setStep("scanning"); setMessage("");
    try {
      const found = libraryDemo() ? demoCandidates : (await digitalProcessManager.importScan([...chosen])).candidates ?? [];
      setRows(found.map(candidate => {
        const options = candidate.app_id != null ? [] : suggest(candidate.name, catalog);
        const choice = candidate.app_id ?? options[0]?.id ?? null;
        return { candidate, options, choice, mode: "link" as const, picked: choice != null && !candidate.duplicate_of };
      }));
      const missing = [...new Set(found.map(candidate => candidate.app_id).filter((id): id is number => id != null && !catalogName.has(id)))];
      if (missing.length) {
        const known = await queryCatalogCache({ app_ids: missing, limit: missing.length }).catch(() => ({ items: [] as CatalogGame[] }));
        setCacheNames(new Map(known.items.map(game => [(game.app_id ?? game.id) as number, game.name])));
      }
      setStep("results");
    } catch (failure) { setMessage(String(failure)); setStep("drives"); }
  };
  const patch = (id: string, change: Partial<Row>) => setRows(current => current.map(row => row.candidate.id === id ? { ...row, ...change } : row));
  const repeated = useMemo(() => duplicateRows(rows.map(row => ({ id: row.candidate.id, path: row.candidate.path, choice: row.choice, duplicateOf: row.candidate.duplicate_of }))), [rows]);
  const chosenRows = rows.filter(row => row.picked && row.choice != null && !repeated.has(row.candidate.id));

  const run = async () => {
    setStep("importing");
    const items: ImportItem[] = chosenRows.map(row => ({ app_id: row.choice as number, name: nameOf(row.choice as number) ?? row.candidate.name, path: row.candidate.path, mode: row.candidate.can_move ? row.mode : "link", kind: row.candidate.kind, executable: row.candidate.executable ? `${row.candidate.path}\\${row.candidate.executable}`.replace(/\\\\+/g, "\\") : "" }));
    try {
      const outcome: Array<{ app_id: number; ok: boolean; error?: string }> = libraryDemo() ? items.map(item => ({ app_id: item.app_id, ok: true })) : (await digitalProcessManager.importRun(items)).results ?? [];
      imported.current = outcome.some(item => item.ok);
      outcome.forEach((item, index) => { if (item.ok && !libraryDemo()) addReadyGameToLibrary(item.app_id, items[index]?.name ?? String(item.app_id), catalog); });
      setResults(outcome.map((item, index) => ({ name: items[index]?.name ?? String(item.app_id), ok: item.ok, error: item.error })));
      const ok = outcome.filter(item => item.ok).length;
      const failed = outcome.length - ok;
      const summary = translate("toastGamesImported", { ok });
      notify(failed ? translate("toastBatchFailures", { summary, failed }) : summary, { tone: !failed ? "success" : ok ? "warning" : "error" });
    } catch (failure) {
      setResults(items.map(item => ({ name: item.name, ok: false, error: String(failure) })));
      notify(translate("toastActionFailed", { error: String(failure) }), { tone: "error" });
    }
    setStep("done");
  };

  const body = (() => {
    if (step === "drives" || step === "scanning") return (
      <div className="grid gap-4">
        <h3 className="m-0 text-lg font-bold">{c.wzDrives}</h3>
        <p className="m-0 text-sm text-muted-foreground">{c.wzDrivesHint}</p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {drives.map(drive => (
            <li key={drive.path}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <Checkbox checked={chosen.has(drive.path)} disabled={step === "scanning"} onCheckedChange={value => setChosen(current => { const next = new Set(current); if (value) next.add(drive.path); else next.delete(drive.path); return next; })} />
                <HardDrive className="size-5 text-muted-foreground" />
                <b>{drive.label}</b>
                <span className="text-sm text-muted-foreground">{formatBytes(drive.free_bytes)} {c.wzFree} {formatBytes(drive.total_bytes)}</span>
              </label>
            </li>
          ))}
        </ul>
        {message ? <p role="alert" className="m-0 text-sm text-[#e1898f]">{message}</p> : null}
      </div>
    );
    if (step === "importing") return <p className="m-0 flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{c.wzImporting}</p>;
    if (step === "done") return (
      <div className="grid gap-3">
        <p className="m-0 font-bold">{c.wzDone(results.filter(r => r.ok).length, results.filter(r => !r.ok).length)}</p>
        <ul className="m-0 grid max-h-[48vh] list-none gap-1 overflow-y-auto p-0 text-sm">{results.map((r, index) => <li key={index} className={r.ok ? "text-success" : "text-[#e1898f]"}>{r.name}{r.error ? ` — ${r.error}` : ""}</li>)}</ul>
      </div>
    );
    return (
      <div className="grid min-h-0 gap-3">
        <div className="flex items-center gap-3"><b>{c.wzFound(rows.length)}</b><span className="text-xs text-muted-foreground">{c.wzLinkHint} {c.wzMoveHint}</span></div>
        {rows.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{c.wzNone}</p> : (
          <div className="relative min-h-0 rounded-lg border border-border bg-card/40">
            <div ref={scrollRef} className="max-h-[48vh] overflow-y-auto overflow-x-hidden pr-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ul className="m-0 grid list-none p-0">
                {rows.map(row => {
                  const { candidate } = row;
                  const firstPath = repeated.get(candidate.id);
                  const title = candidate.app_id != null ? nameOf(candidate.app_id) ?? candidate.name : candidate.name;
                  return (
                    <li key={candidate.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-border/60 px-4 py-3 last:border-b-0">
                      <Checkbox checked={row.picked && !firstPath} disabled={row.choice == null || Boolean(firstPath)} onCheckedChange={value => patch(candidate.id, { picked: Boolean(value) })} aria-label={title} />
                      <div className="grid min-w-0 gap-1">
                        <div className="flex min-w-0 items-center gap-2"><b className="truncate text-sm">{title}</b><Badge variant={candidate.kind === "steam" ? "info" : "default"}>{c.wzSource[candidate.source] ?? candidate.source}</Badge>{firstPath ? <Badge variant="warning"><AlertTriangle className="size-3" />{c.wzDuplicate}</Badge> : null}</div>
                        <span className="truncate text-xs text-muted-foreground">{candidate.path}</span>
                        {firstPath ? <span role="note" className="text-xs text-warning">{c.wzDuplicateOf(firstPath)}</span> : null}
                        {candidate.app_id == null ? (
                          <select aria-label={c.wzCatalog} value={row.choice ?? ""} onChange={event => { const value = event.target.value ? Number(event.target.value) : null; patch(candidate.id, { choice: value, picked: value != null }); }}
                            className="h-8 max-w-sm rounded-md border border-border bg-background px-2 text-xs text-foreground">
                            <option value="">{c.wzNoMatch}</option>
                            {row.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                          </select>
                        ) : <span className="text-xs text-muted-foreground">{nameOf(candidate.app_id) ?? `AppID ${candidate.app_id}`}{candidate.app_id_file ? ` · ${c.wzDetected(candidate.app_id_file)}` : ""}</span>}
                      </div>
                      <div className="grid justify-items-end gap-1">
                        <b className="text-sm tabular-nums">{formatBytes(candidate.size_bytes)}</b>
                        {candidate.can_move ? (
                          <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label={c.wzHow}>
                            {(["link", "move"] as const).map(mode => (
                              <button key={mode} type="button" aria-pressed={row.mode === mode} onClick={() => patch(candidate.id, { mode })}
                                className={cn("flex items-center gap-1 border-0 px-2.5 py-1 font-sans text-xs font-bold", row.mode === mode ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground")}>
                                {mode === "link" ? <Link2 className="size-3" /> : <MoveRight className="size-3" />}{mode === "link" ? c.wzLink : c.wzMove}
                              </button>
                            ))}
                          </div>
                        ) : <span className="text-xs text-muted-foreground">{c.wzSteamOnly}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <CircularScrollbar targetRef={scrollRef} label={c.wzTitle} />
          </div>
        )}
      </div>
    );
  })();

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--window-chrome-height,34px)] z-[700] flex items-center justify-center bg-black/70 p-6 font-sans text-foreground [color-scheme:dark]" role="dialog" aria-modal="true" aria-label={c.wzTitle}>
      <div className="flex max-h-full min-h-0 w-[min(1000px,94vw)] flex-col gap-4 rounded-lg border border-border bg-background p-6 shadow-2xl">
        <header className="flex items-center gap-4">
          <h2 className="ga-screen-title mr-auto !text-4xl">{c.wzTitle}</h2>
          <GaClose label={c.wzClose} disabled={step === "scanning" || step === "importing"} onClick={() => onClose(imported.current)} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
        <footer className="flex justify-end gap-2">
          {step === "results" ? <GaButton icon={<ArrowLeft size={16} />} onClick={() => setStep("drives")}>{c.wzBack}</GaButton> : null}
          {step === "drives" || step === "scanning" ? <GaButton variant="primary" icon={step === "scanning" ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />} disabled={step === "scanning" || chosen.size === 0} onClick={() => void scan()}>{step === "scanning" ? c.wzScanning : c.wzScan}</GaButton> : null}
          {step === "results" ? <GaButton variant="primary" disabled={chosenRows.length === 0} onClick={() => void run()}>{c.wzImport(chosenRows.length)}</GaButton> : null}
          {step === "done" ? <GaButton variant="primary" onClick={() => onClose(imported.current)}>{c.wzClose}</GaButton> : null}
        </footer>
      </div>
    </div>
  );
}
