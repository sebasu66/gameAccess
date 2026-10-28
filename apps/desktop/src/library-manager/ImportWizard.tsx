import { GaButton, GaClose } from "../components/ga/Buttons";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Folder, FolderPlus, HardDrive, Link2, Loader2, MoveRight, ScanSearch, Square, X } from "lucide-react";
import { importScanProgress, importScanStop, type ImportScanProgress } from "../native";
import { ScanProgress } from "./ScanProgress";
import CircularScrollbar from "../CircularScrollbar";
import { digitalProcessManager, type ImportCandidate, type ImportDrive, type ImportItem } from "../catalog/DigitalProcessManager";
import { libraryDemo } from "../libraryScan";
import { uiDemo } from "../devDemo/uiDemo";

/** The browser design modes (`?libraryDemo=1`, `?uiDemo=1`): sample disks and finds, no launcher behind. */
const demo = () => libraryDemo() || uiDemo();
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

/** The folders the player added to the search, remembered on this computer (each with whether it is ticked). */
const FOLDERS_KEY = "gameaccess:import-folders";
function readFolders(): Array<{ path: string; on: boolean }> {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter(item => typeof item?.path === "string").map(item => ({ path: item.path, on: item.on !== false })) : [];
  } catch { return []; }
}
function saveFolders(folders: Array<{ path: string; on: boolean }>) {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch { /* not remembered, still works */ }
}
interface Row { candidate: ImportCandidate; choice: number | null; mode: "link" | "move"; picked: boolean; options: Array<{ id: number; name: string }> }

const demoDrives: ImportDrive[] = [{ path: "C:\\", label: "C:", total_bytes: 931 * 1024 ** 3, free_bytes: 240 * 1024 ** 3 }, { path: "D:\\", label: "D:", total_bytes: 1863 * 1024 ** 3, free_bytes: 1100 * 1024 ** 3 }];
const demoCandidates: ImportCandidate[] = [
  { id: "a", name: "Hades", path: "D:\\SteamLibrary\\steamapps\\common\\Hades", kind: "steam", source: "steam", app_id: 1145360, size_bytes: 15 * 1024 ** 3, executable: "", can_move: false },
  { id: "b", name: "Elden.Ring.v1.10-FitGirl", path: "D:\\Games\\Elden.Ring.v1.10-FitGirl", kind: "folder", source: "library", app_id: null, size_bytes: 52 * 1024 ** 3, executable: "eldenring.exe", can_move: true },
  { id: "c", name: "Mystery Folder", path: "C:\\Users\\me\\Downloads\\Mystery Folder", kind: "folder", source: "downloads", app_id: null, size_bytes: 3 * 1024 ** 3, executable: "go.exe", can_move: true },
];

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

/** The browser design modes: a scan that walks a few made-up folders, finds the sample games and can be stopped. */
async function demoScan(show: (progress: ImportScanProgress) => void, stopped: () => boolean): Promise<{ candidates: ImportCandidate[]; cancelled: boolean }> {
  const folders = ["C:\\", "C:\\Users\\me\\Downloads", "C:\\Users\\me\\Downloads\\Mystery Folder", "C:\\Games", "D:\\", "D:\\SteamLibrary\\steamapps", "D:\\SteamLibrary\\steamapps\\common\\Hades", "D:\\Games", "D:\\Games\\Repacks", "D:\\Games\\Elden.Ring.v1.10-FitGirl", "D:\\Games\\Elden.Ring.v1.10-FitGirl\\Game", "D:\\Games\\Tools"];
  const finds: Record<number, ImportCandidate> = { 2: demoCandidates[2], 6: demoCandidates[0], 9: demoCandidates[1] };
  const found: ImportCandidate[] = [];
  for (const [index, folder] of folders.entries()) {
    if (stopped()) break;
    await sleep(650);
    if (finds[index]) found.push(finds[index]);
    show({ folder, folders: (index + 1) * 37, found: found.map(game => ({ name: game.name, path: game.path, size_bytes: game.size_bytes, kind: game.kind, app_id: game.app_id })), done: false, cancelled: false, started: Date.now() });
  }
  return { candidates: found, cancelled: stopped() };
}

/** Import wizard: choose disks → scan the usual places → review what was found → link in place or move into the library. */
export function ImportWizard({ catalog, c, onClose }: { catalog: CatalogGame[]; c: LibraryCopy; onClose: (imported: boolean) => void }) {
  const [step, setStep] = useState<Step>("drives");
  const [drives, setDrives] = useState<ImportDrive[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [folders, setFoldersState] = useState(readFolders);
  const [folderDraft, setFolderDraft] = useState("");
  const setFolders = (next: Array<{ path: string; on: boolean }>) => { setFoldersState(next); saveFolders(next); };
  const addFolders = (paths: string[]) => {
    const next = [...folders];
    for (const raw of paths) {
      const path = raw.trim().replace(/^"(.*)"$/, "$1");
      if (path && !next.some(item => item.path.toLowerCase() === path.toLowerCase())) next.push({ path, on: true });
    }
    setFolders(next);
  };
  const addFolder = () => { addFolders([folderDraft]); setFolderDraft(""); };
  // In the desktop app "Add folder" opens the system's folder picker (one or several); the typed path is only the
  // browser preview's stand-in, where there is no picker.
  const nativePicker = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const pickFolders = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: true, title: c.wzAddFolder });
      addFolders(picked == null ? [] : Array.isArray(picked) ? picked : [picked]);
    } catch (failure) { setMessage(String(failure)); }
  };
  const pickedFolders = folders.filter(item => item.on).map(item => item.path);
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; error?: string }>>([]);
  const [cacheNames, setCacheNames] = useState<Map<number, string>>(new Map());
  // The scan as it runs (folder being read, games found) and the player's "Stop".
  const [live, setLive] = useState<ImportScanProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stoppedEarly, setStoppedEarly] = useState(false);
  const stopRequested = useRef(false);
  const stop = () => { stopRequested.current = true; setStopping(true); if (!demo()) void importScanStop(); };
  const scrollRef = useRef<HTMLDivElement>(null);
  const imported = useRef(false);

  useEffect(() => {
    let live = true;
    const load = demo() ? Promise.resolve({ drives: demoDrives }) : digitalProcessManager.importDrives();
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
    setStep("scanning"); setMessage(""); setLive(null); setStopping(false); setStoppedEarly(false);
    stopRequested.current = false;
    // While the launcher scans, its progress file is read a few times a second (no Python started for it).
    const poll = demo() ? 0 : window.setInterval(() => { void importScanProgress().then(progress => { if (progress && !progress.done) setLive(progress); }).catch(() => undefined); }, 400);
    try {
      const outcome = demo() ? await demoScan(setLive, () => stopRequested.current)
        : await digitalProcessManager.importScan([...chosen], pickedFolders).then(result => ({ candidates: result.candidates ?? [], cancelled: Boolean(result.cancelled) }));
      window.clearInterval(poll);
      setStoppedEarly(outcome.cancelled);
      const found = outcome.candidates;
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
    } catch (failure) { window.clearInterval(poll); setMessage(String(failure)); setStep("drives"); }
  };
  const patch = (id: string, change: Partial<Row>) => setRows(current => current.map(row => row.candidate.id === id ? { ...row, ...change } : row));
  const repeated = useMemo(() => duplicateRows(rows.map(row => ({ id: row.candidate.id, path: row.candidate.path, choice: row.choice, duplicateOf: row.candidate.duplicate_of }))), [rows]);
  const chosenRows = rows.filter(row => row.picked && row.choice != null && !repeated.has(row.candidate.id));

  const run = async () => {
    setStep("importing");
    const items: ImportItem[] = chosenRows.map(row => ({ app_id: row.choice as number, name: nameOf(row.choice as number) ?? row.candidate.name, path: row.candidate.path, mode: row.candidate.can_move ? row.mode : "link", kind: row.candidate.kind, executable: row.candidate.executable ? `${row.candidate.path}\\${row.candidate.executable}`.replace(/\\\\+/g, "\\") : "" }));
    try {
      const outcome: Array<{ app_id: number; ok: boolean; error?: string }> = demo() ? items.map(item => ({ app_id: item.app_id, ok: true })) : (await digitalProcessManager.importRun(items)).results ?? [];
      imported.current = outcome.some(item => item.ok);
      outcome.forEach((item, index) => { if (item.ok && !demo()) addReadyGameToLibrary(item.app_id, items[index]?.name ?? String(item.app_id), catalog); });
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
    if (step === "scanning") return <ScanProgress progress={live} c={c} />;
    if (step === "drives") return (
      <div className="grid gap-4">
        <h3 className="m-0 text-lg font-bold">{c.wzDrives}</h3>
        <p className="m-0 text-sm text-muted-foreground">{c.wzDrivesHint}</p>
        {/* The disks are short names (C:, D:...): all on one row, each ticked or not; the free space as its tooltip. */}
        {!drives.length && !message ? <p className="m-0 text-sm text-muted-foreground">{c.wzNoDrives}</p> : null}
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {drives.map(drive => (
            <li key={drive.path}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2" title={`${formatBytes(drive.free_bytes)} ${c.wzFree} ${formatBytes(drive.total_bytes)}`}>
                <Checkbox checked={chosen.has(drive.path)} onCheckedChange={value => setChosen(current => { const next = new Set(current); if (value) next.add(drive.path); else next.delete(drive.path); return next; })} aria-label={drive.label} />
                <HardDrive className="size-4 text-muted-foreground" />
                <b>{drive.label}</b>
                <span className="text-xs text-muted-foreground">{formatBytes(drive.free_bytes)}</span>
              </label>
            </li>
          ))}
        </ul>
        <h3 className="m-0 mt-2 text-lg font-bold">{c.wzFolders}</h3>
        <p className="m-0 text-sm text-muted-foreground">{c.wzFoldersHint}</p>
        {folders.length ? <ul className="m-0 grid list-none gap-2 p-0">
          {folders.map(item => (
            <li key={item.path} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <Checkbox checked={item.on} onCheckedChange={value => setFolders(folders.map(other => other.path === item.path ? { ...other, on: Boolean(value) } : other))} />
                <Folder className="size-5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm" title={item.path}>{item.path}</span>
              </label>
              <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-transparent text-muted-foreground hover:text-foreground" aria-label={c.wzRemoveFolder(item.path)} title={c.wzRemoveFolder(item.path)} onClick={() => setFolders(folders.filter(other => other.path !== item.path))}><X className="size-4" /></button>
            </li>
          ))}
        </ul> : null}
        {nativePicker ? <div className="flex">
          <GaButton icon={<FolderPlus size={16} />} onClick={() => void pickFolders()}>{c.wzAddFolder}</GaButton>
        </div> : <form className="flex gap-2" onSubmit={event => { event.preventDefault(); addFolder(); }}>
          <input value={folderDraft} onChange={event => setFolderDraft(event.target.value)} placeholder={c.wzFolderPath} aria-label={c.wzFolderPath}
            className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-[#0d1114] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
          <GaButton type="submit" icon={<FolderPlus size={16} />} disabled={!folderDraft.trim()}>{c.wzAddFolder}</GaButton>
        </form>}
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
        <p className="m-0 text-sm text-muted-foreground">{c.wzLinkHint} {c.wzMoveHint}</p>
        {rows.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{c.wzNone}</p> : (
          <div className="lm-grid-wrap relative min-h-0">
            <div ref={scrollRef} className="max-h-[48vh] overflow-y-auto overflow-x-hidden pr-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* The same grid as the Library Manager: one row per game, clearly separated from the next. */}
              <table className="lm-grid lm-import-grid">
                <thead><tr>
                  <th className="lm-cell-check"><span className="sr-only">{c.wzSelectAll}</span></th>
                  <th>{c.wzGame}</th>
                  <th>{c.wzOrigin}</th>
                  <th className="lm-cell-num">{c.size}</th>
                  <th className="lm-cell-acts">{c.wzHow}</th>
                </tr></thead>
                <tbody>
                {rows.map(row => {
                  const { candidate } = row;
                  const firstPath = repeated.get(candidate.id);
                  const title = candidate.app_id != null ? nameOf(candidate.app_id) ?? candidate.name : candidate.name;
                  return (
                    <tr key={candidate.id} className={cn("lm-row", row.picked && !firstPath ? "is-selected" : "")}>
                      <td className="lm-cell-check"><Checkbox checked={row.picked && !firstPath} disabled={row.choice == null || Boolean(firstPath)} onCheckedChange={value => patch(candidate.id, { picked: Boolean(value) })} aria-label={title} /></td>
                      <td className="lm-cell-name">
                        <div className="grid min-w-0 gap-1">
                          <div className="flex min-w-0 items-center gap-2"><b className="lm-name">{title}</b>{firstPath ? <Badge variant="warning"><AlertTriangle className="size-3" />{c.wzDuplicate}</Badge> : null}</div>
                          <span className="lm-cell-path !max-w-none" title={candidate.path}>{candidate.path}</span>
                          {firstPath ? <span role="note" className="text-xs text-warning">{c.wzDuplicateOf(firstPath)}</span> : null}
                          {candidate.app_id == null ? (
                            <select aria-label={c.wzCatalog} value={row.choice ?? ""} onChange={event => { const value = event.target.value ? Number(event.target.value) : null; patch(candidate.id, { choice: value, picked: value != null }); }}
                              className="h-8 max-w-sm rounded-md border border-border bg-background px-2 text-xs text-foreground">
                              <option value="">{c.wzNoMatch}</option>
                              {row.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                            </select>
                          ) : <span className="text-xs text-muted-foreground">{nameOf(candidate.app_id) ?? `AppID ${candidate.app_id}`}{candidate.app_id_file ? ` · ${c.wzDetected(candidate.app_id_file)}` : ""}</span>}
                        </div>
                      </td>
                      <td><Badge variant={candidate.kind === "steam" ? "info" : "default"}>{c.wzSource[candidate.source] ?? candidate.source}</Badge></td>
                      <td className="lm-cell-num"><b className="tabular-nums">{formatBytes(candidate.size_bytes)}</b></td>
                      <td className="lm-acts">
                        {candidate.can_move ? (
                          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label={c.wzHow}>
                            {(["link", "move"] as const).map(mode => (
                              <button key={mode} type="button" aria-pressed={row.mode === mode} onClick={() => patch(candidate.id, { mode })}
                                className={cn("flex items-center gap-1 border-0 px-2.5 py-1 font-sans text-xs font-bold", row.mode === mode ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground")}>
                                {mode === "link" ? <Link2 className="size-3" /> : <MoveRight className="size-3" />}{mode === "link" ? c.wzLink : c.wzMove}
                              </button>
                            ))}
                          </div>
                        ) : <span className="text-xs text-muted-foreground">{c.wzSteamOnly}</span>}
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
            <CircularScrollbar targetRef={scrollRef} label={c.wzTitle} />
          </div>
        )}
        {stoppedEarly ? <p role="status" className="m-0 text-sm text-amber-300">{c.wzStopped}</p> : null}
        {rows.length ? <p className="m-0 text-sm font-bold">{c.wzFound(rows.length)}</p> : null}
      </div>
    );
  })();

  return (
    <div className="ga-overlay-root fixed inset-x-0 bottom-0 top-[var(--window-chrome-height,34px)] z-[700] flex items-center justify-center bg-black/70 p-6 font-sans text-foreground [color-scheme:dark]" role="dialog" aria-modal="true" aria-label={c.wzTitle}>
      <div className="ga-overlay-dialog flex max-h-full min-h-0 w-[min(1000px,94vw)] flex-col gap-4 p-6">
        <header className="flex items-center gap-4">
          <h2 className="ga-screen-title mr-auto !text-4xl">{c.wzTitle}</h2>
          <GaClose label={c.wzClose} disabled={step === "scanning" || step === "importing"} onClick={() => onClose(imported.current)} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
        <footer className="flex justify-end gap-2">
          {step === "results" ? <GaButton icon={<ArrowLeft size={16} />} onClick={() => setStep("drives")}>{c.wzBack}</GaButton> : null}
          {/* While it scans, the main button stops it; what was found until then is still offered. */}
          {step === "scanning" ? <GaButton icon={stopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={14} fill="currentColor" />} disabled={stopping} onClick={stop}>{stopping ? c.wzStopping : c.wzStop}</GaButton> : null}
          {step === "drives" ? <GaButton variant="primary" icon={<ScanSearch size={16} />} disabled={chosen.size === 0 && pickedFolders.length === 0} onClick={() => void scan()}>{c.wzScan}</GaButton> : null}
          {step === "results" ? <GaButton variant="primary" disabled={chosenRows.length === 0} onClick={() => void run()}>{c.wzImport(chosenRows.length)}</GaButton> : null}
          {step === "done" ? <GaButton variant="primary" onClick={() => onClose(imported.current)}>{c.wzClose}</GaButton> : null}
        </footer>
      </div>
    </div>
  );
}
