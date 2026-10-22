import { Snowflake } from "lucide-react";
import type { LibraryGame } from "../catalog/DigitalProcessManager";
import { Progress } from "../components/ui/progress";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";

/** Size column: what the game takes. A frozen game shows its size on disk, its real size faded and struck
 *  through, and a bar with both (real size pale, on disk solid) so the saving is visible at a glance. */
export function SizeCell({ game, largest, c }: { game: LibraryGame; largest: number; c: LibraryCopy }) {
  const value = game.partial ? game.transfer_bytes ?? 0 : game.size_bytes ?? 0;
  const original = game.original_bytes ?? game.size_bytes ?? 0, stored = game.frozen_bytes ?? null;
  if (!game.frozen || stored == null || !original) {
    return <div className="grid w-40 gap-1"><span className="text-sm font-bold tabular-nums">{formatBytes(value)}</span><Progress value={(value / Math.max(largest, game.transfer_bytes ?? 0)) * 100} indicatorClassName={game.partial ? "bg-info" : undefined} /></div>;
  }
  const scale = Math.max(largest, original), saved = Math.max(0, original - stored);
  const title = game.frozen === "deep" ? c.deepFrozen : c.frozen;
  return (
    <div className="grid w-40 gap-1" data-frozen={game.frozen} title={`${title}: ${formatBytes(stored)} / ${formatBytes(original)}`}>
      <span className="flex items-baseline gap-1.5 text-frost">
        <Snowflake className="size-3.5 shrink-0 self-center" aria-hidden="true" />
        <b className="text-sm tabular-nums">{formatBytes(stored)}</b>
        <span className="text-xs tabular-nums line-through opacity-50">{formatBytes(original)}</span>
      </span>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <span className="absolute inset-y-0 left-0 rounded-full bg-frost opacity-30" style={{ width: `${(original / scale) * 100}%` }} />
        <span className="absolute inset-y-0 left-0 rounded-full bg-frost" style={{ width: `${(stored / scale) * 100}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-frost">{c.saved(formatBytes(saved), Math.round((saved / original) * 100))}</span>
    </div>
  );
}
