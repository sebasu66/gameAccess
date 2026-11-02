import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface RowStat { label: string; value: string }
export interface RowAction { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; tone?: "accent" | "danger" | "frost" }

/** A button of an action list: its icon and its name. A long name ("Resume: continues from…") shows its first part;
 *  the whole of it is its tooltip. */
function ActionButton({ action, onDone }: { action: RowAction; onDone?: () => void }) {
  const short = action.label.split(":")[0];
  return <button type="button" role={onDone ? "menuitem" : undefined} className={action.tone ? `is-${action.tone}` : undefined} disabled={action.disabled}
    title={short === action.label ? undefined : action.label} onClick={() => { onDone?.(); action.onClick(); }}>
    {action.icon}<span>{short}</span>
  </button>;
}

/** The game's actions, each with its name, one under the other (the context menu). */
export function ActionList({ actions, onDone }: { actions: RowAction[]; onDone?: () => void }) {
  return <div className="lm-row-actions">{actions.map(action => <ActionButton key={action.label} action={action} onDone={onDone} />)}</div>;
}

/** The task's percentage: a small ring over the picture. */
function PercentRing({ value, label }: { value: number; label?: string }) {
  const done = Math.max(0, Math.min(100, value));
  return <span className="lm-ring" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done)}>
    <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" /><circle cx="18" cy="18" r="15.5" pathLength={100} strokeDasharray={`${done} 100`} /></svg>
    <b>{Math.floor(done)}%</b>
  </span>;
}

/**
 * A game's row of the Library Manager, open (docs/GUI_DESIGN.md §4.20b, Seba 2026-11-02): one component with the same
 * two halves for every case, so every open row is built alike:
 * - left, the game's log (its one log: download, install, setup, each play, each freeze, with the running task as its
 *   last group). It takes the height of the right half and scrolls inside: no half is taller than the other;
 * - right, the task's picture: the game's wide image with the animation of what is happening (speed graph, ice press,
 *   cubes), its lower part fading into black, the task's figures over that dark base without labels, its percentage in
 *   a small ring over the image; and beside it, one column of tall buttons with all the task's controls together.
 *   With no task running it is the game's still picture alone. The game's actions are in its "⋯" menu, never here.
 */
export default function RowExpand({ logTitle, log, artTitle, art, progress, stats = [], actions = [] }: {
  logTitle: string; log: ReactNode; artTitle?: string; art: ReactNode;
  /** 0..100 for the ring over the picture; undefined or null hides it. */
  progress?: number | null;
  /** The task's figures, shown as their values only (the label is their tooltip). */
  stats?: RowStat[];
  /** All the task's controls (pause, resume, cancel, open its folder…), in the column beside the picture. */
  actions?: RowAction[];
}) {
  // A figure not known yet ("—") is left out rather than shown empty.
  const facts = stats.filter(stat => stat.value && stat.value !== "—");
  return <div className={`lm-expand${actions.length ? " has-controls" : ""}`}>
    <section className="lm-expand-log" aria-label={logTitle}>
      <span className="lm-cell-title">{logTitle}</span>
      <div className="lm-expand-log-body">{log}</div>
    </section>
    <section className="lm-stage" aria-label={artTitle}>
      <div className={`lm-stage-art${facts.length ? " has-facts" : ""}`}>
        {art}
        {artTitle ? <span className="lm-stage-title">{artTitle}</span> : null}
        {progress != null ? <PercentRing value={progress} label={artTitle} /> : null}
        {facts.length ? <div className="lm-stage-facts">{facts.map(stat => <span key={stat.label} title={stat.label}>{stat.value}</span>)}</div> : null}
      </div>
      {actions.length ? <div className="lm-stage-controls">{actions.map(action => <ActionButton key={action.label} action={action} />)}</div> : null}
    </section>
  </div>;
}

/** The game's actions as a context menu (right click on the row, or its "⋯" button): each with its name. Escape, a
 *  click outside or choosing one closes it. */
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
