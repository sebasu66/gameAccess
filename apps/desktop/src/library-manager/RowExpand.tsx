import type { ReactNode } from "react";

/**
 * A game's row of the Library Manager, open (Seba, 2026-11-01): one pattern for every case (a download, a freeze,
 * a move, the game's history). The game's log on the left; on the right its picture, with the animation of what is
 * happening to it. The row above keeps the game's name; its small picture hides while the row is open.
 */
export default function RowExpand({ log, art }: { log: ReactNode; art: ReactNode }) {
  return <div className="lm-expand">
    <div className="lm-expand-log">{log}</div>
    <div className="lm-expand-art">{art}</div>
  </div>;
}
