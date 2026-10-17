import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw, ScanSearch, Trash2, Wand2, Wrench, X } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { digitalProcessManager, type LibraryBatchAction, type LibraryGame } from "./catalog/DigitalProcessManager";
import { scanLibrary, useLibraryScan } from "./libraryScan";
import type { CatalogGame } from "./types";

const copy = {
  es: {
    title: "Administrador de biblioteca", close: "Cerrar", scanning: "Escaneando biblioteca…", empty: "Todavía no hay juegos en la biblioteca.",
    games: "Juegos", used: "Ocupado", transfers: "Descargas a medias", free: "Libre en disco", broken: "Fuera de estándar", reclaim: "Recuperable",
    name: "Juego", size: "Tamaño", status: "Estado", runnable: "Ejecutable", plays: "Partidas",
    yes: "Sí", no: "No", fix: "Hay que procesarlo", ok: "Estándar",
    states: { ready: "Listo", installing: "Instalando", downloading: "Descargando", preparing: "Preparando", ERROR: "Error", legacy: "Formato anterior", unrecognized: "Nombre no reconocido" } as Record<string, string>,
    selected: (n: number) => `${n} seleccionados`, selectAll: "Seleccionar todos", select: "Seleccionar",
    scan: "Escanear", fixSelected: "Corregir marcados", fixAll: "Corregir todo lo fuera de estándar", repair: "Reparar", uninstall: "Desinstalar",
    history: "Historial", noHistory: "Sin pasos registrados.", problems: "Qué le falta",
    confirm: (n: number) => `¿Desinstalar ${n} juego(s)? Se borra su carpeta.`, confirmFix: (n: number) => `¿Corregir ${n} carpeta(s)? Se renombran, se descomprime o instala lo que falte y se borran las copias comprimidas que duplican el juego.`,
    working: "Trabajando…", done: (ok: number, fail: number) => fail ? `${ok} correctos, ${fail} con error.` : `${ok} correctos.`,
    leftovers: "Descargas sin terminar en la carpeta temporal", inProgress: "En curso", discard: "Descartar", leftoverHint: "No tienen juego instalado ni descarga activa; ocupan espacio.",
    confirmDiscard: (n: number) => `¿Descartar ${n} descarga(s) sin terminar? Se borran sus archivos temporales.`,
  },
  en: {
    title: "Library manager", close: "Close", scanning: "Scanning library…", empty: "There are no games in the library yet.",
    games: "Games", used: "Used", transfers: "Unfinished downloads", free: "Free on disk", broken: "Outside the standard", reclaim: "Recoverable",
    name: "Game", size: "Size", status: "Status", runnable: "Runnable", plays: "Plays",
    yes: "Yes", no: "No", fix: "Needs processing", ok: "Standard",
    states: { ready: "Ready", installing: "Installing", downloading: "Downloading", preparing: "Preparing", ERROR: "Error", legacy: "Old format", unrecognized: "Unrecognized name" } as Record<string, string>,
    selected: (n: number) => `${n} selected`, selectAll: "Select all", select: "Select",
    scan: "Scan", fixSelected: "Fix selected", fixAll: "Fix everything outside the standard", repair: "Repair", uninstall: "Uninstall",
    history: "History", noHistory: "No steps recorded.", problems: "What it needs",
    confirm: (n: number) => `Uninstall ${n} game(s)? Their folder is deleted.`, confirmFix: (n: number) => `Fix ${n} folder(s)? They are renamed, unpacked or installed if needed, and compressed copies that duplicate the game are deleted.`,
    working: "Working…", done: (ok: number, fail: number) => fail ? `${ok} succeeded, ${fail} failed.` : `${ok} succeeded.`,
    leftovers: "Unfinished downloads in the temporary folder", inProgress: "In progress", discard: "Discard", leftoverHint: "No installed game and no active download; they take space.",
    confirmDiscard: (n: number) => `Discard ${n} unfinished download(s)? Their temporary files are deleted.`,
  },
};

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"]; let value = bytes; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const asGame = (game: LibraryGame): CatalogGame => ({ id: game.app_id, app_id: game.app_id, name: game.name } as CatalogGame);
const rowKey = (game: LibraryGame) => game.app_id ?? game.folder;

function History({ game }: { game: LibraryGame }) {
  const { locale } = useI18n(); const c = copy[locale] ?? copy.es;
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void digitalProcessManager.gameLog(asGame(game)).then(result => { if (live) setText(result.log ?? ""); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [game.app_id]);
  return text === null ? <p role="status">{c.working}</p> : text ? <pre className="ga-game-log" tabIndex={0}>{text}</pre> : <p>{c.noHistory}</p>;
}

export default function GameLibraryManager({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n(); const c = copy[locale] ?? copy.es;
  const ref = useDialogFocus(onClose);
  const { games, transfers, summary, scanning, error } = useLibraryScan();
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<string | number | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { void scanLibrary(); }, []);

  const withId = useMemo(() => games.filter(game => game.app_id != null), [games]);
  const broken = useMemo(() => withId.filter(game => !game.standard && game.state !== "unrecognized"), [withId]);
  const leftovers = useMemo(() => transfers.filter(item => !withId.some(game => game.app_id === item.app_id && game.installed)), [transfers, withId]);
  const allChosen = withId.length > 0 && withId.every(game => chosen.has(game.app_id!));
  const toggle = (id: number) => setChosen(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });

  const run = async (action: LibraryBatchAction, ids: number[], question?: string) => {
    if (!ids.length || (question && !window.confirm(question))) return;
    setBusy(true); setMessage(c.working);
    try {
      const rows = (await digitalProcessManager.libraryBatch(action, ids)).results ?? [];
      setMessage(c.done(rows.filter(row => row.ok).length, rows.filter(row => !row.ok).length));
      setChosen(new Set()); await scanLibrary();
    } catch (failure) { setMessage(String(failure)); } finally { setBusy(false); }
  };
  const ids = [...chosen];

  return <div className="ga-settings-backdrop" onPointerDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="ga-settings-panel ga-library-manager" role="dialog" aria-modal="true" aria-labelledby="library-manager-title">
      <header><div><h2 id="library-manager-title">{c.title}</h2></div>
        <button type="button" onClick={onClose} aria-label={c.close} data-dialog-initial><X size={20} /></button></header>
      <div className="ga-settings-content">
        {summary ? <dl className="ga-library-summary">
          <div><dt>{c.games}</dt><dd>{summary.count}</dd></div>
          <div><dt>{c.used}</dt><dd>{formatBytes(summary.used_bytes)}</dd></div>
          <div><dt>{c.transfers}</dt><dd>{formatBytes(summary.transfers_bytes)}</dd></div>
          <div><dt>{c.free}</dt><dd>{formatBytes(summary.disk_free_bytes)}</dd></div>
          <div><dt>{c.broken}</dt><dd>{summary.nonstandard}</dd></div>
          <div><dt>{c.reclaim}</dt><dd>{formatBytes(summary.reclaimable_bytes)}</dd></div>
        </dl> : null}
        <div className="ga-library-actions" role="toolbar">
          <button type="button" onClick={() => void scanLibrary()} disabled={busy || scanning}><ScanSearch size={16} /> {c.scan}</button>
          <button type="button" onClick={() => void run("adopt", broken.map(game => game.app_id!), c.confirmFix(broken.length))} disabled={busy || !broken.length}><Wand2 size={16} /> {c.fixAll} ({broken.length})</button>
          <span>{c.selected(chosen.size)}</span>
          <button type="button" onClick={() => void run("adopt", ids, c.confirmFix(ids.length))} disabled={busy || !ids.length}><RefreshCw size={16} /> {c.fixSelected}</button>
          <button type="button" onClick={() => void run("repair", ids)} disabled={busy || !ids.length}><Wrench size={16} /> {c.repair}</button>
          <button type="button" onClick={() => void run("uninstall", ids, c.confirm(ids.length))} disabled={busy || !ids.length}><Trash2 size={16} /> {c.uninstall}</button>
          {busy || scanning ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null}
        </div>
        {message ? <p role="status">{message}</p> : null}
        {error ? <p className="ga-settings-error" role="alert">{error}</p> : null}
        {scanning && !games.length ? <p role="status">{c.scanning}</p> : !games.length ? <p>{c.empty}</p> :
          <table className="ga-library-table">
            <thead><tr>
              <th><input type="checkbox" aria-label={c.selectAll} checked={allChosen} onChange={() => setChosen(allChosen ? new Set() : new Set(withId.map(game => game.app_id!)))} /></th>
              <th>{c.name}</th><th>{c.size}</th><th>{c.status}</th><th>{c.runnable}</th><th>{c.plays}</th></tr></thead>
            <tbody>{games.map(game => {
              const key = rowKey(game); const expanded = open === key;
              return [
                <tr key={String(key)} data-broken={!game.standard || undefined}>
                  <td>{game.app_id != null ? <input type="checkbox" aria-label={`${c.select} ${game.name}`} checked={chosen.has(game.app_id)} onChange={() => toggle(game.app_id!)} /> : null}</td>
                  <td><button type="button" className="ga-library-expand" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {game.name}</button></td>
                  <td>{formatBytes(game.size_bytes)}</td>
                  <td>{c.states[game.state] ?? game.state}</td>
                  <td>{!game.standard ? <span className="ga-library-warning" title={game.warning}><AlertTriangle size={14} /> {c.fix}</span> : game.installed ? c.yes : c.no}</td>
                  <td>{game.plays ?? 0}</td>
                </tr>,
                expanded ? <tr key={`${key}-detail`}><td /><td colSpan={5}>
                  {game.issues.length ? <><strong>{c.problems}</strong><ul>{game.issues.map(issue => <li key={issue.code}>{issue.message}{issue.bytes ? ` (${formatBytes(issue.bytes)})` : ""}</li>)}</ul></> : null}
                  {game.app_id != null ? <><strong>{c.history}</strong><History game={game} /></> : <p>{game.folder}</p>}</td></tr> : null,
              ];
            })}</tbody>
          </table>}
        {leftovers.length ? <section className="ga-library-leftovers">
          <h3>{c.leftovers}</h3><p>{c.leftoverHint}</p>
          <ul>{leftovers.map(item => <li key={item.app_id}>
            <span>{item.name} · {formatBytes(item.size_bytes)}</span>
            {item.active ? <em> {c.inProgress}</em> : <button type="button" disabled={busy} onClick={() => void run("discard_transfer", [item.app_id], c.confirmDiscard(1))}><Trash2 size={14} /> {c.discard}</button>}
          </li>)}</ul>
        </section> : null}
      </div>
    </section>
  </div>;
}
