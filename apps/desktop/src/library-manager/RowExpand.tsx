import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface RowStat { label: string; value: string }
export interface RowAction { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; tone?: "accent" | "danger" | "frost" }

/** One cell of the open row: a title line of the same height in every cell (empty when it has none), then its content.
 *  So the cells start on the same line whatever they hold. */
function Cell({ area, title, children }: { area: "log" | "art" | "menu"; title?: string; children?: ReactNode }) {
  return <section className={`lm-cell lm-cell-${area}`} aria-label={title}>
    <span className="lm-cell-title" aria-hidden={title ? undefined : true}>{title ?? " "}</span>
    <div className="lm-cell-body">{children}</div>
  </section>;
}

/** A button of an action list: its icon and its name. A long name ("Resume: continues from…") shows its first part;
 *  the whole of it is its tooltip. */
function ActionButton({ action, onDone }: { action: RowAction; onDone?: () => void }) {
  const short = action.label.split(":")[0];
  return <button type="button" role={onDone ? "menuitem" : undefined} className={action.tone ? `is-${action.tone}` : undefined} disabled={action.disabled}
    title={short === action.label ? undefined : action.label} onClick={() => { onDone?.(); action.onClick(); }}>
    {action.icon}<span>{short}</span>
  </button>;
}

/** The game's actions, each with its name, one under the other (the open row's menu and the context menu). */
export function ActionList({ actions, onDone }: { actions: RowAction[]; onDone?: () => void }) {
  return <div className="lm-row-actions">{actions.map(action => <ActionButton key={action.label} action={action} onDone={onDone} />)}</div>;
}

/**
 * A game's row of the Library Manager, open (docs/GUI_DESIGN.md §4.20b, Seba 2026-11-02): one grid with the same three
 * cells for every process (a download, its install, a freeze, a move) and for the game's history alone:
 * - the game's log (its one log: download, install, setup, each play, each freeze) with the running process at its end.
 *   It takes the height of the other cells (never less than its minimum): the row never has a taller column;
 * - the game's wide picture with the animation of what is happening and its bar at the base; under it the process's
 *   buttons in one row and its figures (done, speed, time left, how much of the total);
 * - the game's actions, each with its name, one under the other.
 * Empty cells keep their place, so every open row lines up with the others.
 */
export default function RowExpand({ logTitle, log, artTitle, art, progress, stats = [], actions = [], menuTitle, menu = [] }: {
  logTitle: string; log: ReactNode; artTitle?: string; art: ReactNode;
  /** 0..100 for the bar at the picture's base; undefined or null hides it. */
  progress?: number | null; stats?: RowStat[];
  /** The running process's buttons (pause, resume, cancel…), under the picture. */
  actions?: RowAction[];
  menuTitle?: string; menu?: RowAction[];
}) {
  return <div className="lm-expand">
    <Cell area="log" title={logTitle}>{log}</Cell>
    <Cell area="art" title={artTitle}>
      <div className="lm-art">
        {art}
        {progress != null ? <i className="lm-art-bar" role="progressbar" aria-label={artTitle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><b style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></i> : null}
      </div>
      {actions.length ? <div className="lm-process-actions">{actions.map(action => <ActionButton key={action.label} action={action} />)}</div> : null}
      {stats.length ? <dl className="lm-stats">{stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl> : null}
    </Cell>
    <Cell area="menu" title={menu.length ? menuTitle : undefined}>{menu.length ? <ActionList actions={menu} /> : null}</Cell>
  </div>;
}

/** The game's actions as a context menu (right click on the row, or its "⋯" button): the same list as the open row's,
 *  each with its name. Escape, a click outside or choosing one closes it. */
export function RowMenu({ at, title, actions, onClose }: { at: { x: number; y: number }; title: string; actions: RowAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  // Kept inside the window: it opens upwards or to the left when there is no room.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({ x: Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8)), y: Math.max(8, at.y + box.height > window.innerHeight - 8 ? at.y - box.height : at.y) });
  }, [at.x, at.y]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key, true); window.removeEventListener("blur", onClose); };
  }, [onClose]);
  return createPortal(<div ref={ref} className="lm-menu" role="menu" aria-label={title} style={{ left: place.x, top: place.y }} onContextMenu={event => event.preventDefault()}>
    <span className="lm-cell-title">{title}</span>
    <ActionList actions={actions} onDone={onClose} />
  </div>, document.body);
}
