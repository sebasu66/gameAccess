import type { ReactNode } from "react";

export interface RowStat { label: string; value: string }
export interface RowAction { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; tone?: "accent" | "danger" }

/** One cell of the open row: a title line of the same height in every cell (empty when it has none), then its content.
 *  So the four cells start on the same line whatever they hold. */
function Cell({ area, title, children }: { area: "log" | "art" | "stats" | "actions"; title?: string; children?: ReactNode }) {
  return <section className={`lm-cell lm-cell-${area}`} aria-label={title}>
    <span className="lm-cell-title" aria-hidden={title ? undefined : true}>{title ?? " "}</span>
    <div className="lm-cell-body">{children}</div>
  </section>;
}

/**
 * A game's row of the Library Manager, open (docs/GUI_DESIGN.md §4.20b, Seba 2026-11-01): one grid with the same four
 * cells for every process (a download, its install, a freeze, a move) and for the game's history alone:
 * - the game's log (its one log: download, install, setup, each play, each freeze) with the running process at its end;
 * - the game's wide picture with the animation of what is happening and, at its base, the process's bar;
 * - the process's figures (done, speed, time left, how much of the total), beside the picture on a wide screen and
 *   under it on a narrow one;
 * - the process's buttons, small, one under the other.
 * Empty cells keep their place, so every open row lines up with the others.
 */
export default function RowExpand({ logTitle, log, artTitle, art, progress, stats = [], actions = [] }: {
  logTitle: string; log: ReactNode; artTitle?: string; art: ReactNode;
  /** 0..100 for the bar at the picture's base; undefined or null hides it. */
  progress?: number | null; stats?: RowStat[]; actions?: RowAction[];
}) {
  return <div className="lm-expand">
    <Cell area="log" title={logTitle}>{log}</Cell>
    <Cell area="art" title={artTitle}>
      <div className="lm-art">
        {art}
        {progress != null ? <i className="lm-art-bar" role="progressbar" aria-label={artTitle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><b style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></i> : null}
      </div>
    </Cell>
    <Cell area="stats">{stats.length ? <dl className="lm-stats">{stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl> : null}</Cell>
    <Cell area="actions">{actions.length ? <div className="lm-row-actions">
      {actions.map(action => <button key={action.label} type="button" className={action.tone ? `is-${action.tone}` : undefined} disabled={action.disabled} onClick={action.onClick}>{action.icon}<span>{action.label}</span></button>)}
    </div> : null}</Cell>
  </div>;
}
