import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw, Trash2, Wrench, X } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { digitalProcessManager, type LibraryBatchAction, type LibraryGame, type LibrarySummary } from "./catalog/DigitalProcessManager";
import type { CatalogGame } from "./types";

const copy = {
  es: {
    title: "Administrador de biblioteca", close: "Cerrar", loading: "Leyendo biblioteca…", empty: "Todavía no hay juegos en la biblioteca.",
    games: "Juegos", used: "Ocupado", free: "Libre en disco", broken: "Con problemas",
    name: "Juego", size: "Tamaño", status: "Estado", runnable: "Ejecutable", plays: "Partidas",
    yes: "Sí", no: "No", ok: "Listo", fix: "Necesita reparación",
    states: { ready: "Listo", installing: "Instalando", downloading: "Descargando", preparing: "Preparando", ERROR: "Error", legacy: "Sin estado" } as Record<string, string>,
    selected: (n: number) => `${n} seleccionados`, selectAll: "Seleccionar todos", select: "Seleccionar",
    repair: "Reparar", uninstall: "Desinstalar", refresh: "Actualizar", history: "Historial", noHistory: "Sin pasos registrados.",
    confirm: (n: number) => `¿Desinstalar ${n} juego(s)? Se borra su carpeta.`, working: "Trabajando…",
    done: (ok: number, fail: number) => fail ? `${ok} correctos, ${fail} con error.` : `${ok} correctos.`,
  },
  en: {
    title: "Library manager", close: "Close", loading: "Reading library…", empty: "There are no games in the library yet.",
    games: "Games", used: "Used", free: "Free on disk", broken: "With problems",
    name: "Game", size: "Size", status: "Status", runnable: "Runnable", plays: "Plays",
    yes: "Yes", no: "No", ok: "Ready", fix: "Needs repair",
    states: { ready: "Ready", installing: "Installing", downloading: "Downloading", preparing: "Preparing", ERROR: "Error", legacy: "No status" } as Record<string, string>,
    selected: (n: number) => `${n} selected`, selectAll: "Select all", select: "Select",
    repair: "Repair", uninstall: "Uninstall", refresh: "Refresh", history: "History", noHistory: "No steps recorded.",
    confirm: (n: number) => `Uninstall ${n} game(s)? Their folder is deleted.`, working: "Working…",
    done: (ok: number, fail: number) => fail ? `${ok} succeeded, ${fail} failed.` : `${ok} succeeded.`,
  },
};

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"]; let value = bytes; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const asGame = (game: LibraryGame): CatalogGame => ({ id: game.app_id, app_id: game.app_id, name: game.name } as CatalogGame);

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
  const [games, setGames] = useState<LibraryGame[] | null>(null);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await digitalProcessManager.libraryList();
      setGames(result.library ?? []); setSummary(result.summary ?? null);
    } catch (failure) { setMessage(String(failure)); setGames([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const allChosen = useMemo(() => Boolean(games?.length) && games!.every(game => chosen.has(game.app_id)), [games, chosen]);
  const toggle = (id: number) => setChosen(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const run = async (action: LibraryBatchAction) => {
    const ids = [...chosen];
    if (!ids.length || (action === "uninstall" && !window.confirm(c.confirm(ids.length)))) return;
    setBusy(true); setMessage(c.working);
    try {
      const result = await digitalProcessManager.libraryBatch(action, ids);
      const rows = result.results ?? [];
      setMessage(c.done(rows.filter(row => row.ok).length, rows.filter(row => !row.ok).length));
      setChosen(new Set()); await load();
    } catch (failure) { setMessage(String(failure)); } finally { setBusy(false); }
  };

  return <div className="ga-settings-backdrop" onPointerDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="ga-settings-panel ga-library-manager" role="dialog" aria-modal="true" aria-labelledby="library-manager-title">
      <header><div><h2 id="library-manager-title">{c.title}</h2></div>
        <button type="button" onClick={onClose} aria-label={c.close} data-dialog-initial><X size={20} /></button></header>
      <div className="ga-settings-content">
        {summary ? <dl className="ga-library-summary">
          <div><dt>{c.games}</dt><dd>{summary.count}</dd></div>
          <div><dt>{c.used}</dt><dd>{formatBytes(summary.used_bytes)}</dd></div>
          <div><dt>{c.free}</dt><dd>{formatBytes(summary.disk_free_bytes)}</dd></div>
          <div><dt>{c.broken}</dt><dd>{summary.needs_repair}</dd></div>
        </dl> : null}
        <div className="ga-library-actions" role="toolbar">
          <button type="button" onClick={() => void load()} disabled={busy}><RefreshCw size={16} /> {c.refresh}</button>
          <span>{c.selected(chosen.size)}</span>
          <button type="button" onClick={() => void run("repair")} disabled={busy || !chosen.size}><Wrench size={16} /> {c.repair}</button>
          <button type="button" onClick={() => void run("uninstall")} disabled={busy || !chosen.size}><Trash2 size={16} /> {c.uninstall}</button>
          {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null}
        </div>
        {message ? <p role="status">{message}</p> : null}
        {games === null ? <p role="status">{c.loading}</p> : !games.length ? <p>{c.empty}</p> :
          <table className="ga-library-table">
            <thead><tr>
              <th><input type="checkbox" aria-label={c.selectAll} checked={allChosen} onChange={() => setChosen(allChosen ? new Set() : new Set(games.map(game => game.app_id)))} /></th>
              <th>{c.name}</th><th>{c.size}</th><th>{c.status}</th><th>{c.runnable}</th><th>{c.plays}</th></tr></thead>
            <tbody>{games.map(game => {
              const expanded = open === game.app_id;
              return [
                <tr key={game.app_id} data-broken={game.needs_repair || undefined}>
                  <td><input type="checkbox" aria-label={`${c.select} ${game.name}`} checked={chosen.has(game.app_id)} onChange={() => toggle(game.app_id)} /></td>
                  <td><button type="button" className="ga-library-expand" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : game.app_id)}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {game.name}</button></td>
                  <td>{formatBytes(game.size_bytes)}</td>
                  <td>{c.states[game.state] ?? game.state}</td>
                  <td>{game.needs_repair ? <span className="ga-library-warning" title={game.warning}><AlertTriangle size={14} /> {c.fix}</span> : game.installed ? c.yes : c.no}</td>
                  <td>{game.plays ?? 0}</td>
                </tr>,
                expanded ? <tr key={`${game.app_id}-history`}><td /><td colSpan={5}>
                  {game.warning ? <p className="ga-settings-error">{game.warning}</p> : null}
                  <strong>{c.history}</strong><History game={game} /></td></tr> : null,
              ];
            })}</tbody>
          </table>}
      </div>
    </section>
  </div>;
}
